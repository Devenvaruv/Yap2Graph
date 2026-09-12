# Yap2Graph

Intent-aware personal research & memory system (hackathon prototype). See `PRD.md` for the product spec and `tasks/` for the build plan.

## Local Cognee service

Cognee runs only on this machine through the uv-managed FastAPI service in `cognee-service/`. Its data remains in `cognee-service/.cognee/`.

1. Copy `cognee-service/.env.example` to `cognee-service/.env`.
2. Set `LLM_API_KEY` and `EMBEDDING_API_KEY` in that file. Cognee needs these provider credentials to build and query its local graph.
3. Synchronize the Python environment and start the service in separate terminals:

```bash
npm run cognee:sync
npm run cognee:serve
```

4. Confirm the service is available:

```bash
npm run cognee:check
```

The service listens on `http://localhost:8000` by default. Set `COGNEE_API_URL` in the root `.env` to use another local address.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open <http://localhost:3000>.

## Ingest the fixture corpus

With the local Cognee service running, execute:

```bash
npm run ingest
```

This writes activities to `data/activities.json`, uploads normalized documents to local Cognee, and waits for `cognify` to complete. A second unchanged run is cached; delete `data/local-cognee-ingestion-cache.json` to force another local Cognee ingestion.

## Tests

```bash
npm test
```
