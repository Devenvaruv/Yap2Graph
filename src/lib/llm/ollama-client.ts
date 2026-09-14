import { z } from "zod";
import type { ChatMessage, EmbeddingClient, LlmClient, OllamaClientConfig } from "./types";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
  response?: string;
};

type OllamaEmbedResponse = {
  embeddings?: number[][];
  embedding?: number[];
};

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Ollama client: baseUrl is required.");
  }
  return trimmed;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Ollama request failed at ${url}: ${(err as Error).message}. Is Ollama running?`,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ollama request failed at ${url}: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

export class OllamaLlmClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly smallModel: string;
  private readonly largeModel: string;
  private readonly maxRetries: number;

  constructor(config: OllamaClientConfig = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? "http://localhost:11434");
    this.smallModel = config.smallModel ?? "qwen3:4b-instruct";
    this.largeModel = config.largeModel ?? this.smallModel;
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
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "Respond with JSON only. Do not include markdown fences, commentary, or reasoning text.",
      },
      ...(params.schemaHint
        ? [
            {
              role: "system" as const,
              content: `Expected JSON schema:\n${params.schemaHint}`,
            },
          ]
        : []),
      ...params.messages,
    ];

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

      const response = await postJson<OllamaChatResponse>(
        `${this.baseUrl}/api/chat`,
        {
          model,
          messages,
          format: "json",
          stream: false,
          options: {
            temperature: 0,
          },
        },
      );

      const raw = response.message?.content ?? response.response ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(OllamaLlmClient.extractJson(raw));
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
      `OllamaLlmClient: model output failed schema validation after ${this.maxRetries + 1} attempt(s). ${lastError?.message ?? ""}`,
    );
  }

  static extractJson(raw: string): string {
    const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    return match ? match[1].trim() : raw.trim();
  }
}

export class OllamaEmbeddingClient implements EmbeddingClient {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: Pick<OllamaClientConfig, "baseUrl" | "embeddingModel"> = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? "http://localhost:11434");
    this.model = config.embeddingModel ?? "nomic-embed-text:latest";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await postJson<OllamaEmbedResponse>(
      `${this.baseUrl}/api/embed`,
      {
        model: this.model,
        input: texts,
      },
    );

    if (response.embeddings) return response.embeddings;
    if (response.embedding) return [response.embedding];

    throw new Error("OllamaEmbeddingClient: unexpected embedding response shape.");
  }
}
