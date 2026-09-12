import "dotenv/config";
import { CodingAgentAdapter } from "../src/lib/adapters";
import { ChatGptAdapter } from "../src/lib/adapters";
import { EmailAdapter } from "../src/lib/adapters";
import { CodexConnector } from "../src/lib/connectors/codex-connector";
import { GmailConnector } from "../src/lib/connectors/gmail-connector";
import { ChatGptConnector } from "../src/lib/connectors/chatgpt-connector";
import { RealCogneeClient } from "../src/lib/cognee";
import { CannedPipelineLlm } from "../src/lib/fixtures/canned-extraction";
import { runIngestion, type RawExport } from "../src/lib/ingestion";

const LOCAL_CACHE_PATH = "data/live-ingestion-cache.json";

async function main(): Promise<void> {
  const llm = new CannedPipelineLlm();
  const apiUrl = process.env.COGNEE_API_URL ?? "http://localhost:8000";
  const cognee = new RealCogneeClient({ apiUrl });

  const rawExports: RawExport[] = [];

  const databaseUrl = process.env.DATABASE_URL;
  const activityDate = process.env.CHATGPT_ACTIVITY_DATE ?? new Date().toISOString().slice(0, 10);
  if (databaseUrl) {
    const chatgpt = new ChatGptConnector({ databaseUrl, date: activityDate });
    try {
      const chatgptRaw = await chatgpt.fetch();
      rawExports.push({ name: `chatgpt-${activityDate}`, sourceType: "chatgpt", raw: chatgptRaw });
      console.log(`ChatGPT daily activity fetched (${activityDate}).`);
    } catch (err) {
      console.warn(
        `ChatGPT connector skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
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
      console.log(`Refresh token obtained: ${token.slice(0, 10)}...`);
      console.log("Set GMAIL_REFRESH_TOKEN in .env for non-interactive runs.");
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

  const result = await runIngestion(rawExports, {
    llm,
    cognee,
    cachePath: LOCAL_CACHE_PATH,
    adapters: {
      coding_agent: new CodingAgentAdapter(),
      email: new EmailAdapter(),
      chatgpt: new ChatGptAdapter(),
    },
  });

  if (result.skipped) {
    console.log("Ingestion skipped — inputs unchanged (cache hit).");
    console.log(`Activities in store: ${result.activities.length}`);
    return;
  }

  console.log("Ingestion complete.");
  console.log(`Documents: ${result.documents.length}`);
  console.log(`Activities: ${result.activities.length}`);
  for (const activity of result.activities) {
    console.log(
      `  [${activity.status}] ${activity.title} (${activity.project}, evidence: ${activity.evidenceIds.length})`,
    );
  }
}

main().catch((err) => {
  console.error(
    `Live ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
