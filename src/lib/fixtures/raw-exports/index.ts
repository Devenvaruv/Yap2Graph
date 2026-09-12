import codingAgentExport from "./coding-agent.json";
import chatgptExport from "./chatgpt.json";
import emailExport from "./email.json";
import { adaptRawInputs, type RawExport } from "../../ingestion";
import type { SourceDocument } from "../../schemas";

/**
 * The full fixture corpus as raw source exports — the stand-in for the
 * user's real ChatGPT/email/coding-agent exports until those land. One file
 * per source, adapted through the real T03 adapters by the ingestion
 * pipeline (T07).
 */
export const fixtureRawExports: RawExport[] = [
  {
    name: "chatgpt.json",
    sourceType: "chatgpt",
    raw: JSON.stringify(chatgptExport),
  },
  {
    name: "email.json",
    sourceType: "email",
    raw: JSON.stringify(emailExport),
  },
  {
    name: "coding-agent.json",
    sourceType: "coding_agent",
    raw: JSON.stringify(codingAgentExport),
  },
];

/**
 * The normalized documents the raw exports adapt to, in input order — the
 * corpus `npm run ingest` pushes through map/merge and into Cognee. Ids,
 * source types, timestamps (same instant), participants, and content mirror
 * the T02 corpus in ../documents.json; only adapter-derived metadata
 * (conversation/session ids, messageCount, endTime, email labels) and email
 * titles (= raw subject lines) differ, which is why assertions downstream
 * are id-based.
 */
export const fixtureIngestionDocuments: SourceDocument[] =
  adaptRawInputs(fixtureRawExports);
