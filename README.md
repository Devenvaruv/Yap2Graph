# Yap2Graph

Intent-aware personal research & memory system (hackathon prototype). See `PRD.md` for the product spec and `tasks/` for the build plan.

## Local Cognee service

Cognee runs only on this machine through the uv-managed FastAPI service in `cognee-service/`. Its data remains in `cognee-service/.cognee/`.

1. Copy `cognee-service/.env.example` to `cognee-service/.env`.
2. Make sure Ollama is running locally and the two required models are present:

```bash
ollama pull qwen3:4b-instruct
ollama pull nomic-embed-text
```

3. Synchronize the Python environment and start the service in separate terminals:

```bash
npm run cognee:sync
npm run cognee:serve
```

4. Confirm the service is available:

```bash
npm run cognee:check
```

The Yap2Graph Cognee service listens on `http://localhost:8010` by default. Set `COGNEE_API_URL` in the root `.env` to use another local address. This is the only Cognee backend this project uses.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open <http://localhost:3001>.

The Next.js app uses Ollama directly through `OLLAMA_BASE_URL`,
`OLLAMA_CHAT_MODEL`, and `OLLAMA_EMBEDDING_MODEL`. No OpenAI API key is needed.

The app uses port 3001 so the Gmail live-ingestion OAuth callback can keep
using `http://localhost:3000/auth/google/callback`.

Local port map:

- Yap2Graph app: `http://localhost:3001`
- Yap2Graph Cognee API: `http://localhost:8010`
- Yap2Graph mind map: `http://localhost:3001/mindmap`
- Gmail OAuth callback: `http://localhost:3000/auth/google/callback`

The mind map uses the repo-local Cognee API/storage directly, so it shows the
same `main_dataset` populated by `npm run ingest:live`. Direct graph endpoints
are also available:

```text
http://localhost:8010/api/v1/visualize?dataset=main_dataset&full=true
http://localhost:8010/api/v1/graph?dataset=main_dataset&full=true
```

Do not use `cognee-cli -ui` for this project. It starts a separate Cognee
instance with separate storage, which makes the brain look empty. Use
`/mindmap` instead.

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
