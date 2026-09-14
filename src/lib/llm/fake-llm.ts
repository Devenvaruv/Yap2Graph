import { z } from "zod";
import type { ChatMessage, EmbeddingClient, LlmClient, LlmCall } from "./types";

/**
 * Test fake for {@link LlmClient}. Callers push canned responses in test
 * setup (either parsed values or Zod errors); the fake returns them in
 * FIFO order. Every call is recorded for assertion. Zero network, zero
 * nondeterminism.
 */
export class FakeLlm implements LlmClient {
  private queue: Array<
    | { kind: "value"; value: unknown }
    | { kind: "error"; error: Error }
  > = [];
  private _history: LlmCall[] = [];

  enqueue<T>(response: T): this {
    this.queue.push({ kind: "value", value: response });
    return this;
  }

  enqueueError(error: Error): this {
    this.queue.push({ kind: "error", error });
    return this;
  }

  /**
   * Enqueue a value that will FAIL Zod validation when chatJson is called
   * with `schema`. Useful for exercising the validation-error path without
   * depending on the real Ollama client.
   */
  enqueueInvalid(invalid: unknown): this {
    this.queue.push({
      kind: "error",
      error: Object.assign(new Error("Zod validation failed (canned)"), {
        __cannedInvalid: true,
        invalidValue: invalid,
      }),
    });
    return this;
  }

  get history(): ReadonlyArray<LlmCall> {
    return this._history;
  }

  reset(): void {
    this.queue = [];
    this._history = [];
  }

  async chatJson<T>(params: {
    messages: ChatMessage[];
    schema: z.ZodType<T>;
    purpose: "extraction" | "merge" | "scoring" | "generation";
    schemaHint?: string;
  }): Promise<T> {
    const entry = this.queue.shift();
    if (!entry) {
      throw new Error(
        "FakeLlm: no queued response — call enqueue() in test setup.",
      );
    }

    this._history.push({
      messages: params.messages,
      purpose: params.purpose,
      model: `fake:${params.purpose}`,
    });

    if (entry.kind === "error") throw entry.error;

    // Re-validate the canned value against the caller's schema so a stale
    // fixture surfaces immediately rather than producing silent drift.
    const parsed = params.schema.safeParse(entry.value);
    if (!parsed.success) {
      throw new Error(
        `FakeLlm: canned response failed caller schema validation: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }
}

/**
 * Test fake for {@link EmbeddingClient}. Returns deterministic unit vectors
 * — the i-th input gets a one-hot vector with 1 at index (i mod dims). Good
 * enough for relevance tests that need stable, reproducible vectors with
 * zero network cost.
 */
export class FakeEmbeddings implements EmbeddingClient {
  private _history: string[][] = [];
  private readonly dims: number;

  constructor(dims: number = 16) {
    if (!Number.isInteger(dims) || dims <= 0) {
      throw new Error("FakeEmbeddings: dims must be a positive integer.");
    }
    this.dims = dims;
  }

  get history(): ReadonlyArray<string[]> {
    return this._history;
  }

  reset(): void {
    this._history = [];
  }

  async embed(texts: string[]): Promise<number[][]> {
    this._history.push([...texts]);
    return texts.map((_, idx) => {
      const vec = new Array<number>(this.dims).fill(0);
      vec[idx % this.dims] = 1;
      return vec;
    });
  }
}
