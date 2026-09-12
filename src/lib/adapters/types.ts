import type { SourceDocument } from "../schemas";

export interface SourceAdapter {
  readonly sourceType: "chatgpt" | "email" | "coding_agent";
  adapt(rawExport: string): SourceDocument[];
}
