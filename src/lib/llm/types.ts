import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * The pipeline-facing LLM seam. Implementations may wrap the OpenAI SDK
 * (production) or return canned responses (test fakes). Callers never import
 * a specific provider — they depend on this interface only.
 *
 * `chatJson` is the only completion method because every downstream consumer
 * (map, merge, relevance, generation — T05/T06/T10/T12) requires structured
 * JSON validated against a Zod schema. Free-form text output is not a seam
 * this project exposes.
 */
export interface LlmClient {
  chatJson<T>(params: {
    messages: ChatMessage[];
    schema: z.ZodType<T>;
    purpose: "extraction" | "merge" | "scoring" | "generation";
    /** Optional hint appended to the system message so the model knows the shape. */
    schemaHint?: string;
  }): Promise<T>;
}

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
}

export interface LlmCall {
  messages: ChatMessage[];
  purpose: string;
  /** Empty string for the OpenAI client when the caller didn't override. */
  model: string;
}

/**
 * Model selection is config — the client picks the model based on `purpose`,
 * so pipeline code never names a model directly.
 */
export interface OpenAiClientConfig {
  apiKey: string;
  smallModel?: string;
  largeModel?: string;
  embeddingModel?: string;
  /** Max additional attempts after the first call when JSON validation fails. Default 1. */
  maxRetries?: number;
  /** Optional override of the OpenAI base URL (useful for proxies). */
  baseUrl?: string;
}
