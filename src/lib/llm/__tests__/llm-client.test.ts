import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FakeEmbeddings, FakeLlm } from "../fake-llm";
import { OllamaEmbeddingClient, OllamaLlmClient } from "../ollama-client";

const simpleSchema = z.object({
  title: z.string(),
  confidence: z.number(),
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
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

describe("OllamaLlmClient", () => {
  it("uses qwen3:4b-instruct by default", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        message: { content: JSON.stringify({ title: "x", confidence: 1 }) },
      }),
    );
    const client = new OllamaLlmClient();

    await client.chatJson({
      messages: [{ role: "user", content: "extract" }],
      schema: simpleSchema,
      purpose: "extraction",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"model":"qwen3:4b-instruct"'),
      }),
    );
  });

  it("uses the large model for generation when configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        message: { content: JSON.stringify({ title: "x", confidence: 1 }) },
      }),
    );
    const client = new OllamaLlmClient({
      smallModel: "qwen3:4b-instruct",
      largeModel: "qwen3:8b",
    });

    await client.chatJson({
      messages: [{ role: "user", content: "generate" }],
      schema: simpleSchema,
      purpose: "generation",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.model).toBe("qwen3:8b");
  });

  it("extracts JSON from ```json fenced blocks", () => {
    const raw = '```json\n{"title":"x","confidence":0.5}\n```';
    expect(OllamaLlmClient.extractJson(raw)).toBe(
      '{"title":"x","confidence":0.5}',
    );
  });

  it("retries once when the first response fails Zod validation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ message: { content: JSON.stringify({ wrong: "shape" }) } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          message: { content: JSON.stringify({ title: "ok", confidence: 0.7 }) },
        }),
      );
    const client = new OllamaLlmClient();

    const result = await client.chatJson({
      messages: [{ role: "user", content: "extract" }],
      schema: simpleSchema,
      purpose: "extraction",
    });

    expect(result).toEqual({ title: "ok", confidence: 0.7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(secondBody.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringMatching(/Validation errors/),
    });
  });

  it("throws after exhausting the retry budget", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ message: { content: JSON.stringify({ wrong: "shape" }) } }),
    );
    const client = new OllamaLlmClient({ maxRetries: 1 });

    await expect(
      client.chatJson({
        messages: [{ role: "user", content: "extract" }],
        schema: simpleSchema,
        purpose: "extraction",
      }),
    ).rejects.toThrow(/failed schema validation after 2 attempt/);
  });

  it("retries when the model returns non-JSON text", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ message: { content: "not json at all" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          message: { content: JSON.stringify({ title: "ok", confidence: 1 }) },
        }),
      );
    const client = new OllamaLlmClient();

    const result = await client.chatJson({
      messages: [{ role: "user", content: "extract" }],
      schema: simpleSchema,
      purpose: "extraction",
    });

    expect(result).toEqual({ title: "ok", confidence: 1 });
  });

  it("propagates request errors without retrying", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("connection refused"));
    const client = new OllamaLlmClient({ maxRetries: 2 });

    await expect(
      client.chatJson({
        messages: [{ role: "user", content: "go" }],
        schema: simpleSchema,
        purpose: "extraction",
      }),
    ).rejects.toThrow("connection refused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OllamaEmbeddingClient", () => {
  it("uses nomic-embed-text:latest by default", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2, 0.3]] }));
    const client = new OllamaEmbeddingClient();
    await client.embed(["hello"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"model":"nomic-embed-text:latest"'),
      }),
    );
  });

  it("honors a custom embedding model", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2, 0.3]] }));
    const client = new OllamaEmbeddingClient({
      embeddingModel: "nomic-embed-text",
    });
    await client.embed(["hello"]);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.model).toBe("nomic-embed-text");
  });

  it("short-circuits on an empty input array", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const client = new OllamaEmbeddingClient();
    const result = await client.embed([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
