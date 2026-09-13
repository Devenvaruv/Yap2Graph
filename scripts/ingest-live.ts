import "dotenv/config";
import { CodexConnector } from "../src/lib/connectors/codex-connector";
import { GmailConnector } from "../src/lib/connectors/gmail-connector";
import { ChatGptConnector } from "../src/lib/connectors/chatgpt-connector";
import { RealCogneeClient } from "../src/lib/cognee";
import {
  defaultAdapters,
  hashDocument,
  hashDocuments,
  loadIngestionCache,
  saveIngestionCache,
  type RawExport,
} from "../src/lib/ingestion";
import type { SourceDocument } from "../src/lib/schemas";

const LOCAL_CACHE_PATH = "data/live-cognee-ingestion-cache.json";
const CHATGPT_ACTIVITY_DAYS = 2;

function isoDateDaysAgo(daysAgo: number, from: Date = new Date()): string {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function chatGptActivityDates(): string[] {
  const explicitDate = process.env.CHATGPT_ACTIVITY_DATE;
  if (explicitDate) return [explicitDate];
  return Array.from({ length: CHATGPT_ACTIVITY_DAYS }, (_, daysAgo) =>
    isoDateDaysAgo(daysAgo),
  );
}

async function ingestDocumentsToCognee(
  rawExports: readonly RawExport[],
  cognee: RealCogneeClient,
): Promise<{
  documents: SourceDocument[];
  addedToCognee: SourceDocument[];
  cognified: boolean;
}> {
  const adapters = defaultAdapters();
  const cache = await loadIngestionCache(LOCAL_CACHE_PATH);
  const documents: SourceDocument[] = [];
  const currentInputNames = new Set<string>();

  for (const input of rawExports) {
    currentInputNames.add(input.name);
    const inputDocuments = adapters[input.sourceType].adapt(input.raw);
    documents.push(...inputDocuments);
    cache.inputs[input.name] = {
      inputHash: hashDocuments(inputDocuments),
      documentIds: inputDocuments.map((document) => document.id),
      candidates: [],
    };
  }

  for (const name of Object.keys(cache.inputs)) {
    if (!currentInputNames.has(name)) delete cache.inputs[name];
  }

  const docsToAdd = documents.filter(
    (document) => cache.addedDocuments[document.id] !== hashDocument(document),
  );

  let cognified = false;
  if (docsToAdd.length > 0) {
    await cognee.add(docsToAdd);
    await cognee.cognify();
    cognified = true;
    for (const document of docsToAdd) {
      cache.addedDocuments[document.id] = hashDocument(document);
    }
  }

  await saveIngestionCache(cache, LOCAL_CACHE_PATH);

  return { documents, addedToCognee: docsToAdd, cognified };
}

async function main(): Promise<void> {
  const apiUrl = process.env.COGNEE_API_URL ?? "http://localhost:8010";
  const cognee = new RealCogneeClient({ apiUrl });

  const rawExports: RawExport[] = [];

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    for (const activityDate of chatGptActivityDates()) {
      const chatgpt = new ChatGptConnector({ databaseUrl, date: activityDate });
      try {
        const chatgptRaw = await chatgpt.fetch();
        rawExports.push({
          name: `chatgpt-${activityDate}`,
          sourceType: "chatgpt",
          raw: chatgptRaw,
        });
        console.log(`ChatGPT daily activity fetched (${activityDate}).`);
      } catch (err) {
        console.warn(
          `ChatGPT connector skipped (${activityDate}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else {
    console.log("ChatGPT connector skipped: DATABASE_URL not set.");
  }

  const codex = new CodexConnector();
  try {
    const codexRaw = await codex.fetch();
    rawExports.push({ name: "codex-live", sourceType: "coding_agent", raw: codexRaw });
    console.log("Codex sessions fetched.");
  } catch (err) {
    console.warn(
      `Codex connector skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) {
    const gmail = new GmailConnector({
      clientId,
      clientSecret,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    });

    if (!gmail.getRefreshToken()) {
      console.log("No Gmail refresh token — starting interactive OAuth...");
      const token = await gmail.authenticateInteractive();
      console.log("Refresh token obtained. Add this to .env for non-interactive runs:");
      console.log(`GMAIL_REFRESH_TOKEN=${token}`);
    }

    try {
      const gmailRaw = await gmail.fetch();
      rawExports.push({ name: "gmail-live", sourceType: "email", raw: gmailRaw });
      console.log("Gmail messages fetched.");
    } catch (err) {
      console.warn(
        `Gmail connector skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    console.log("Gmail connector skipped: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set.");
  }

  if (rawExports.length === 0) {
    console.error("No live sources available — nothing to ingest.");
    process.exitCode = 1;
    return;
  }

  const result = await ingestDocumentsToCognee(rawExports, cognee);

  console.log("Ingestion complete.");
  console.log(`Documents: ${result.documents.length}`);
  console.log(
    `Cognee: added ${result.addedToCognee.length} document(s), cognified: ${result.cognified ? "yes" : "no"}`,
  );
  if (result.addedToCognee.length === 0) {
    console.log("Cognee ingestion skipped - documents unchanged (cache hit).");
  }
}

main().catch((err) => {
  console.error(
    `Live ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
