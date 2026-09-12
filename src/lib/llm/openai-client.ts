import OpenAI from "openai";
import { z } from "zod";
import type {
  ChatMessage,
  EmbeddingClient,
  LlmClient,
  OpenAiClientConfig,
} from "./types";

/**
 * Production LLM client backed by the OpenAI TS SDK. Model selection is
 * driven by `purpose` so pipeline code never names a model directly — the
 * PRD calls for a small model (gpt-4o-mini class) for extraction/merge/
 * scoring and a larger model for final generation.
 *
 * JSON validation is centralized here: every structured-output caller gets
 * the same retry-on-invalid-JSON contract, so downstream pipeline code
 * doesn't have to duplicate it.
 */
export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI;
  private readonly smallModel: string;
  private readonly largeModel: string;
  private readonly maxRetries: number;

  constructor(config: OpenAiClientConfig) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new Error(
        "OpenAiLlmClient: apiKey is required — set OPENAI_API_KEY in .env.",
      );
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.smallModel = config.smallModel ?? "gpt-4o-mini";
    this.largeModel = config.largeModel ?? "gpt-4o";
    this.maxRetries = config.maxRetries ?? 1;
  }

  async chatJson<T>(params: {
    messages: ChatMessage[];
    schema: z.ZodType<T>;
    purpose: "extraction" | "merge" | "scoring" | "generation";
    schemaHint?: string;
  }): Promise<T> {
    const model =
      params.purpose === "generation" ? this.largeModel : this.smallModel;

    const messages: ChatMessage[] = params.schemaHint
      ? [
          {
            role: "system",
            content: `Respond with JSON only. Expected schema:\n${params.schemaHint}`,
          },
          ...params.messages,
        ]
      : [...params.messages];

    let lastError: z.ZodError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0 && lastError) {
        messages.push({
          role: "user",
          content:
            `Your previous response did not match the schema. ` +
            `Validation errors: ${lastError.message}. ` +
            `Return ONLY valid JSON matching the schema.`,
        });
      }

      const response = await this.client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content ?? "";

      let parsed: unknown;
      try {
        parsed = JSON.parse(OpenAiLlmClient.extractJson(raw));
      } catch (err) {
        lastError = new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `Invalid JSON from model: ${(err as Error).message}`,
          },
        ]);
        continue;
      }

      const result = params.schema.safeParse(parsed);
      if (result.success) return result.data;

      lastError = result.error;
    }

    throw new Error(
      `OpenAiLlmClient: model output failed schema validation after ${this.maxRetries + 1} attempt(s). ${lastError?.message ?? ""}`,
    );
  }

  /**
   * Extract a JSON substring from a model response, tolerating ```json
   * fenced blocks that some models still emit even under
   * `response_format: json_object`. Exposed as `static` for unit tests.
   */
  static extractJson(raw: string): string {
    const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    return match ? match[1].trim() : raw.trim();
  }
}

/**
 * Production embedding client. PRD specifies `text-embedding-3-small` and a
 * single `OPENAI_API_KEY` shared with the LLM client.
 */
export class OpenAiEmbeddingClient implements EmbeddingClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    config: Pick<OpenAiClientConfig, "apiKey" | "baseUrl"> & {
      embeddingModel?: string;
    },
  ) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new Error(
        "OpenAiEmbeddingClient: apiKey is required — set OPENAI_API_KEY in .env.",
      );
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.model = config.embeddingModel ?? "text-embedding-3-small";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((d) => d.embedding);
  }
}
