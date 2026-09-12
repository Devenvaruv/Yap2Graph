import { describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../../schemas";
import { RealCogneeClient } from "../real-cognee-client";

function makeDoc(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: "doc-1",
    sourceType: "chatgpt",
    title: "Test document",
    timestamp: "2026-09-05T10:00:00Z",
    participants: ["alice"],
    content: "Some content about the project.",
    metadata: { thread: "t1" },
    ...overrides,
  };
}

interface MockFetchCall {
  url: string;
  init: RequestInit;
}

function mockFetch(
  responses: Array<{ ok: boolean; status: number; body?: unknown }>,
): { fn: typeof fetch; calls: MockFetchCall[] } {
  const calls: MockFetchCall[] = [];
  let idx = 0;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    const resp = responses[idx++] ?? { ok: false, status: 500 };
    return {
      ok: resp.ok,
      status: resp.status,
      json: async () => resp.body,
      text: async () => (typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body ?? "")),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("RealCogneeClient", () => {
  describe("add", () => {
    it("does nothing when given zero documents", async () => {
      const { fn, calls } = mockFetch([]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });
      await client.add([]);
      expect(calls).toHaveLength(0);
    });

    it("sends multipart form with documents and metadata", async () => {
      const { fn, calls } = mockFetch([{ ok: true, status: 200, body: { status: "ok" } }]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        datasetName: "my_dataset",
        fetch: fn,
      });

      const docs = [
        makeDoc({ id: "d1" }),
        makeDoc({ id: "d2", sourceType: "email", title: "Email doc" }),
      ];
      await client.add(docs);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://cognee.test/api/v1/add");
      expect(calls[0].init.method).toBe("POST");

      const form = calls[0].init.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get("datasetName")).toBe("my_dataset");

      const metadataRaw = form.get("external_metadata") as string;
      const metadata = JSON.parse(metadataRaw) as Array<{ document_id: string }>;
      expect(metadata).toEqual([
        { document_id: "d1", source_type: "chatgpt" },
        { document_id: "d2", source_type: "email" },
      ]);

      const files = form.getAll("data");
      expect(files).toHaveLength(2);
    });

    it("throws on non-ok response", async () => {
      const { fn } = mockFetch([
        { ok: false, status: 422, body: "bad payload" },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      await expect(client.add([makeDoc()])).rejects.toThrow(/422/);
    });
  });

  describe("cognify", () => {
    it("sends cognify request with dataset name", async () => {
      const { fn, calls } = mockFetch([
        { ok: true, status: 200, body: { status: "completed" } },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        datasetName: "ds1",
        fetch: fn,
      });

      await client.cognify();

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://cognee.test/api/v1/cognify");
      const body = JSON.parse(calls[0].init.body as string) as { datasets: string[] };
      expect(body.datasets).toEqual(["ds1"]);
    });

    it("polls status when pipeline_run_id is returned", async () => {
      const { fn, calls } = mockFetch([
        { ok: true, status: 200, body: { status: "running", pipeline_run_id: "run-1" } },
        { ok: true, status: 200, body: { status: "running" } },
        { ok: true, status: 200, body: { status: "completed" } },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
        cognifyPollIntervalMs: 1,
      });

      await client.cognify();

      expect(calls).toHaveLength(3);
      expect(calls[1].url).toBe("http://cognee.test/api/v1/cognify/status/run-1");
      expect(calls[2].url).toBe("http://cognee.test/api/v1/cognify/status/run-1");
    });

    it("throws when cognify returns a failed status", async () => {
      const { fn } = mockFetch([
        { ok: true, status: 200, body: { status: "running", pipeline_run_id: "run-2" } },
        { ok: true, status: 200, body: { status: "failed" } },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
        cognifyPollIntervalMs: 1,
      });

      await expect(client.cognify()).rejects.toThrow(/failed/);
    });

    it("throws when poll attempts are exhausted", async () => {
      const responses = [
        { ok: true, status: 200, body: { status: "running", pipeline_run_id: "run-3" } },
        ...Array.from({ length: 3 }, () => ({
          ok: true,
          status: 200,
          body: { status: "running" },
        })),
      ];
      const { fn } = mockFetch(responses);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
        maxCognifyPollAttempts: 3,
        cognifyPollIntervalMs: 1,
      });

      await expect(client.cognify()).rejects.toThrow(/did not complete/);
    });

    it("throws on non-ok cognify response", async () => {
      const { fn } = mockFetch([{ ok: false, status: 500, body: "server error" }]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      await expect(client.cognify()).rejects.toThrow(/500/);
    });
  });

  describe("search", () => {
    it("sends search request with mapped search type", async () => {
      const { fn, calls } = mockFetch([
        { ok: true, status: 200, body: [] },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        datasetName: "ds1",
        fetch: fn,
      });

      await client.search("what happened", "summaries");

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://cognee.test/api/v1/search");
      const body = JSON.parse(calls[0].init.body as string) as {
        query: string;
        search_type: string;
        datasets: string[];
      };
      expect(body.query).toBe("what happened");
      expect(body.search_type).toBe("SUMMARIES");
      expect(body.datasets).toEqual(["ds1"]);
    });

    it("maps chunks to CHUNKS", async () => {
      const { fn, calls } = mockFetch([
        { ok: true, status: 200, body: [] },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      await client.search("query", "chunks");

      const body = JSON.parse(calls[0].init.body as string) as { search_type: string };
      expect(body.search_type).toBe("CHUNKS");
    });

    it("normalizes search response with excerpt and documentId", async () => {
      const { fn } = mockFetch([
        {
          ok: true,
          status: 200,
          body: [
            {
              search_result: {
                text: "Summary of project work",
                document_id: "doc-1",
              },
              dataset_id: "ds-uuid",
              dataset_name: "main",
            },
            {
              search_result: {
                content: "Chunk content here",
                metadata: { document_id: "doc-2" },
              },
              dataset_id: "ds-uuid",
              dataset_name: "main",
            },
          ],
        },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      const results = await client.search("query", "summaries");

      expect(results).toEqual([
        { excerpt: "Summary of project work", documentId: "doc-1" },
        { excerpt: "Chunk content here", documentId: "doc-2" },
      ]);
    });

    it("returns null documentId when id cannot be extracted", async () => {
      const { fn } = mockFetch([
        {
          ok: true,
          status: 200,
          body: [
            {
              search_result: { text: "Orphan result" },
              dataset_id: "ds-uuid",
              dataset_name: "main",
            },
          ],
        },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      const results = await client.search("query", "chunks");
      expect(results).toEqual([{ excerpt: "Orphan result", documentId: null }]);
    });

    it("handles string search results", async () => {
      const { fn } = mockFetch([
        {
          ok: true,
          status: 200,
          body: [{ search_result: "plain text result", dataset_id: "x", dataset_name: "y" }],
        },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      const results = await client.search("query", "summaries");
      expect(results).toEqual([{ excerpt: "plain text result", documentId: null }]);
    });

    it("drops entries with null search_result", async () => {
      const { fn } = mockFetch([
        {
          ok: true,
          status: 200,
          body: [
            { search_result: null, dataset_id: "x", dataset_name: "y" },
            { search_result: { text: "valid" }, dataset_id: "x", dataset_name: "y" },
          ],
        },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      const results = await client.search("query", "summaries");
      expect(results).toHaveLength(1);
      expect(results[0].excerpt).toBe("valid");
    });

    it("returns empty array for non-array response", async () => {
      const { fn } = mockFetch([
        { ok: true, status: 200, body: { unexpected: "shape" } },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      const results = await client.search("query", "chunks");
      expect(results).toEqual([]);
    });

    it("extracts documentId from external_metadata", async () => {
      const { fn } = mockFetch([
        {
          ok: true,
          status: 200,
          body: [
            {
              search_result: {
                text: "via external_metadata",
                external_metadata: { document_id: "ext-doc-1" },
              },
              dataset_id: "x",
              dataset_name: "y",
            },
          ],
        },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      const results = await client.search("query", "summaries");
      expect(results[0].documentId).toBe("ext-doc-1");
    });

    it("throws on non-ok search response", async () => {
      const { fn } = mockFetch([
        { ok: false, status: 503, body: "service unavailable" },
      ]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      await expect(client.search("q", "summaries")).rejects.toThrow(/503/);
    });
  });

  describe("healthCheck", () => {
    it("succeeds on ok response", async () => {
      const { fn, calls } = mockFetch([{ ok: true, status: 200, body: {} }]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      await client.healthCheck();

      expect(calls[0].url).toBe("http://cognee.test/api/v1/health");
      expect(calls[0].init.method).toBe("GET");
    });

    it("throws on non-ok response", async () => {
      const { fn } = mockFetch([{ ok: false, status: 503, body: "down" }]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test",
        fetch: fn,
      });

      await expect(client.healthCheck()).rejects.toThrow(/503/);
    });
  });

  describe("constructor", () => {
    it("strips trailing slash from apiUrl", async () => {
      const { fn, calls } = mockFetch([{ ok: true, status: 200, body: {} }]);
      const client = new RealCogneeClient({
        apiUrl: "http://cognee.test///",
        fetch: fn,
      });

      await client.healthCheck();
      expect(calls[0].url).toBe("http://cognee.test/api/v1/health");
    });

    it("throws when no fetch is available", () => {
      const originalFetch = globalThis.fetch;
      try {
        delete (globalThis as { fetch?: typeof fetch }).fetch;
        expect(() => new RealCogneeClient({ apiUrl: "http://x" })).toThrow(
          /no fetch implementation/,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
