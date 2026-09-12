import { StubCognee } from "../src/lib/cognee";
import { CannedPipelineLlm } from "../src/lib/fixtures/canned-extraction";
import { fixtureRawExports } from "../src/lib/fixtures/raw-exports";
import { runIngestion } from "../src/lib/ingestion";

/**
 * Deterministic end-to-end ingest of the raw fixture exports: adapters →
 * map pass → merge pass → data/activities.json, plus the stubbed Cognee seam.
 * No network, no API keys — the LLM is canned and Cognee is a stub. A second
 * run with unchanged inputs is a cache no-op.
 */
async function main(): Promise<void> {
  const llm = new CannedPipelineLlm();
  const cognee = new StubCognee();
  const result = await runIngestion(fixtureRawExports, { llm, cognee });

  if (result.skipped) {
    console.log("Ingestion skipped — inputs unchanged (cache hit).");
    console.log(`Activities in store: ${result.activities.length}`);
    return;
  }

  const extractionCalls = llm.history.filter(
    (call) => call.purpose === "extraction",
  ).length;
  const mergeCalls = llm.history.filter(
    (call) => call.purpose === "merge",
  ).length;

  console.log("Ingestion complete.");
  console.log(
    `Documents: ${result.documents.length} (extracted ${result.extractedDocuments.length} via ${extractionCalls} extraction call(s))`,
  );
  console.log(`Candidates: ${result.candidates.length}`);
  console.log(`Merge calls: ${mergeCalls}`);
  console.log(`Activities: ${result.activities.length}`);
  console.log(
    `Cognee: added ${result.addedToCognee.length} document(s), cognified: ${result.cognified ? "yes" : "no"}`,
  );
  for (const activity of result.activities) {
    console.log(
      `  [${activity.status}] ${activity.title} (${activity.project}, evidence: ${activity.evidenceIds.length})`,
    );
  }
}

main().catch((err) => {
  console.error(
    `Ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
