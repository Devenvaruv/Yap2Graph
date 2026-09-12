import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FakeEmbeddings, FakeLlm } from "../fake-llm";
import { OpenAiEmbeddingClient, OpenAiLlmClient } from "../openai-client";

const chatCreateSpy = vi.fn();
const embeddingsCreateSpy = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: chatCreateSpy } };
    embeddings = { create: embeddingsCreateSpy };
    constructor(_opts?: unknown) {
      /* captured via the spies above */
    }
  }
  return { default: MockOpenAI, __esModule: true };
});

const simpleSchema = z.object({
  title: z.string(),
  confidence: z.number(),
});

afterEach(() => {
  vi.restoreAllMocks();
  chatCreateSpy.mockReset();
  embeddingsCreateSpy.mockReset();
});

describe("FakeLlm", () => {
  it("returns queued structured responses in FIFO order", async () => {
    const fake = new FakeLlm()
      .enqueue({ title: "first", confidence: 0.8 })
      .enqueue({ title: "second", confidence: 0.6 });

    const first = await fake.chatJson({
      messages: [{ role: "user", content: "go" }],
      schema: simpleSchema,
      purpose: "extraction",
    });
    const second = await fake.chatJson({
      messages: [{ role: "user", content: "again" }],
      schema: simpleSchema,
      purpose: "extraction",
    });

    expect(first).toEqual({ title: "first", confidence: 0.8 });
    expect(second).toEqual({ title: "second", confidence: 0.6 });
  });

  it("rejects canned responses that don't match the caller's schema", async () => {
    const fake = new FakeLlm().enqueue({ wrong: "shape" });
    await expect(
      fake.chatJson({
        messages: [{ role: "user", content: "go" }],
        schema: simpleSchema,
        purpose: "merge",
      }),
    ).rejects.toThrow(/schema validation/);
  });

  it("throws when the queue is empty", async () => {
    const fake = new FakeLlm();
    await expect(
      fake.chatJson({
        messages: [{ role: "user", content: "go" }],
        schema: simpleSchema,
        purpose: "scoring",
      }),
    ).rejects.toThrow(/no queued response/);
  });

  it("surfaces enqueued errors directly", async () => {
    const fake = new FakeLlm().enqueueError(new Error("rate-limited"));
    await expect(
      fake.chatJson({
        messages: [{ role: "user", content: "go" }],
        schema: simpleSchema,
        purpose: "generation",
      }),
    ).rejects.toThrow("rate-limited");
  });

  it("records every call with purpose-derived model tag", async () => {
    const fake = new FakeLlm().enqueue({ title: "x", confidence: 1 });
    await fake.chatJson({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "msg" },
      ],
      schema: simpleSchema,
      purpose: "extraction",
    });
    expect(fake.history).toHaveLength(1);
    expect(fake.history[0]).toMatchObject({
      purpose: "extraction",
      model: "fake:extraction",
    });
    expect(fake.history[0].messages).toHaveLength(2);
  });

  it("reset() clears queue and history", async () => {
    const fake = new FakeLlm().enqueue({ title: "x", confidence: 1 });
    await fake.chatJson({
      messages: [{ role: "user", content: "go" }],
      schema: simpleSchema,
      purpose: "extraction",
    });
    fake.reset();
    expect(fake.history).toHaveLength(0);
    await expect(
      fake.chatJson({
        messages: [{ role: "user", content: "go" }],
        schema: simpleSchema,
        purpose: "extraction",
      }),
    ).rejects.toThrow(/no queued response/);
  });
});

describe("FakeEmbeddings", () => {
  it("returns deterministic unit vectors of configured dims", async () => {
    const emb = new FakeEmbeddings(4);
    const vecs = await emb.embed(["a", "b", "c"]);
    expect(vecs).toEqual([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ]);
  });

  it("wraps indices back to the beginning when inputs exceed dims", async () => {
    const emb = new FakeEmbeddings(2);
    const vecs = await emb.embed(["a", "b", "c"]);
    expect(vecs).toEqual([
      [1, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it("records every call", async () => {
    const emb = new FakeEmbeddings();
    await emb.embed(["first"]);
    await emb.embed(["second"]);
    expect(emb.history).toEqual([["first"], ["second"]]);
  });

  it("uses 16 dims by default", async () => {
    const emb = new FakeEmbeddings();
    const [vec] = await emb.embed(["x"]);
    expect(vec).toHaveLength(16);
  });

  it("rejects non-positive dims", () => {
    expect(() => new FakeEmbeddings(0)).toThrow(/positive integer/);
  });
});

describe("OpenAiLlmClient", () => {
  it("fails fast when apiKey is missing", () => {
    expect(() => new OpenAiLlmClient({ apiKey: "" })).toThrow(
      /apiKey is required/,
    );
    expect(() => new OpenAiLlmClient({ apiKey: "   " })).toThrow(
      /apiKey is required/,
    );
  });

  it("uses the small model for extraction/merge/scoring", async () => {
    const client = new OpenAiLlmClient({ apiKey: "sk-test" });
    chatCreateSpy.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ title: "x", confidence: 1 }) } }],
    });

    await client.chatJson({
      messages: [{ role: "user", content: "extract" }],
      schema: simpleSchema,
      purpose: "extraction",
    });

    expect(chatCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  it("uses the large model for generation", async () => {
    const client = new OpenAiLlmClient({ apiKey: "sk-test" });
    chatCreateSpy.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ title: "x", confidence: 1 }) } }],
    });

    await client.chatJson({
      messages: [{ role: "user", content: "generate" }],
      schema: simpleSchema,
      purpose: "generation",
    });

    expect(chatCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" }),
    );
  });

  it("extracts JSON from ```json fenced blocks", () => {
    const raw = '```json\n{"title":"x","confidence":0.5}\n```';
    expect(OpenAiLlmClient.extractJson(raw)).toBe(
      '{"title":"x","confidence":0.5}',
    );
  });

  it("retries once when the first response fails Zod validation", async () => {
    const client = new OpenAiLlmClient({ apiKey: "sk-test" });
    chatCreateSpy
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ wrong: "shape" }) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ title: "ok", confidence: 0.7 }) } }],
      });

    const result = await client.chatJson({
      messages: [{ role: "user", content: "extract" }],
      schema: simpleSchema,
      purpose: "extraction",
    });

    expect(result).toEqual({ title: "ok", confidence: 0.7 });
    expect(chatCreateSpy).toHaveBeenCalledTimes(2);
    const secondCall = chatCreateSpy.mock.calls[1][0];
    expect(secondCall.messages[1]).toMatchObject({
      role: "user",
      content: expect.stringMatching(/Validation errors/),
    });
  });

  it("throws after exhausting the retry budget", async () => {
    const client = new OpenAiLlmClient({ apiKey: "sk-test", maxRetries: 1 });
    const bad = { choices: [{ message: { content: JSON.stringify({ wrong: "shape" }) } }] };
    chatCreateSpy.mockResolvedValue(bad);

    await expect(
      client.chatJson({
        messages: [{ role: "user", content: "extract" }],
        schema: simpleSchema,
        purpose: "extraction",
      }),
    ).rejects.toThrow(/failed schema validation after 2 attempt/);
    expect(chatCreateSpy).toHaveBeenCalledTimes(2);
  });

  it("retries when the model returns non-JSON text", async () => {
    const client = new OpenAiLlmClient({ apiKey: "sk-test" });
    chatCreateSpy
      .mockResolvedValueOnce({
        choices: [{ message: { content: "not json at all" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ title: "ok", confidence: 1 }) } }],
      });

    const result = await client.chatJson({
      messages: [{ role: "user", content: "extract" }],
      schema: simpleSchema,
      purpose: "extraction",
    });

    expect(result).toEqual({ title: "ok", confidence: 1 });
    expect(chatCreateSpy).toHaveBeenCalledTimes(2);
  });

  it("respects custom model overrides", async () => {
    const client = new OpenAiLlmClient({
      apiKey: "sk-test",
      smallModel: "gpt-5-mini",
      largeModel: "gpt-5",
    });
    const ok = { choices: [{ message: { content: JSON.stringify({ title: "x", confidence: 1 }) } }] };
    chatCreateSpy.mockResolvedValue(ok);

    await client.chatJson({
      messages: [{ role: "user", content: "go" }],
      schema: simpleSchema,
      purpose: "extraction",
    });
    await client.chatJson({
      messages: [{ role: "user", content: "go" }],
      schema: simpleSchema,
      purpose: "generation",
    });

    expect(chatCreateSpy.mock.calls[0][0].model).toBe("gpt-5-mini");
    expect(chatCreateSpy.mock.calls[1][0].model).toBe("gpt-5");
  });

  it("propagates SDK errors without retrying", async () => {
    const client = new OpenAiLlmClient({ apiKey: "sk-test", maxRetries: 2 });
    chatCreateSpy.mockRejectedValue(new Error("401 unauthorized"));

    await expect(
      client.chatJson({
        messages: [{ role: "user", content: "go" }],
        schema: simpleSchema,
        purpose: "extraction",
      }),
    ).rejects.toThrow("401 unauthorized");
    expect(chatCreateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAiEmbeddingClient", () => {
  it("fails fast when apiKey is missing", () => {
    expect(() => new OpenAiEmbeddingClient({ apiKey: "" })).toThrow(
      /apiKey is required/,
    );
  });

  it("uses text-embedding-3-small by default", async () => {
    embeddingsCreateSpy.mockResolvedValueOnce({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
    const client = new OpenAiEmbeddingClient({ apiKey: "sk-test" });
    await client.embed(["hello"]);

    expect(embeddingsCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "text-embedding-3-small", input: ["hello"] }),
    );
  });

  it("honours a custom embedding model", async () => {
    embeddingsCreateSpy.mockResolvedValueOnce({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
    const client = new OpenAiEmbeddingClient({
      apiKey: "sk-test",
      embeddingModel: "text-embedding-3-large",
    });
    await client.embed(["hello"]);

    expect(embeddingsCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "text-embedding-3-large" }),
    );
  });

  it("short-circuits on an empty input array", async () => {
    const client = new OpenAiEmbeddingClient({ apiKey: "sk-test" });
    const result = await client.embed([]);

    expect(result).toEqual([]);
    expect(embeddingsCreateSpy).not.toHaveBeenCalled();
  });
});
