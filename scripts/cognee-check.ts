import { RealCogneeClient } from "../src/lib/cognee";

const apiUrl = process.env.COGNEE_API_URL ?? "http://localhost:8010";

const client = new RealCogneeClient({ apiUrl });

console.log(`Pinging Cognee at ${apiUrl} ...`);
client
  .healthCheck()
  .then(() => {
    console.log("Cognee is healthy.");
  })
  .catch((err: unknown) => {
    console.error(
      "Cognee health check failed:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
