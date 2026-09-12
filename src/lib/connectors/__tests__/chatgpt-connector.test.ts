import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatGptConnector } from "../chatgpt-connector";
import { ChatGptAdapter } from "../../adapters/chatgpt-adapter";

const sqlMock = vi.fn();
const endMock = vi.fn();

vi.mock("postgres", () => ({
  default: vi.fn(() => {
    const template = vi.fn(async () => {
      const rows = await sqlMock();
      return Array.isArray(rows) ? rows : [];
    });
    (template as unknown as { json: unknown }).json = (value: unknown) => value;
    (template as unknown as { end: unknown }).end = endMock;
    return template;
  }),
}));

import postgres from "postgres";

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([]);
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
});

describe("ChatGptConnector", () => {
  it("queries daily_activities for the given date and source", async () => {
    sqlMock.mockResolvedValue([
      {
        date: "2026-09-12",
        source: "chatgpt",
        summary: "Shipped the ingestion pipeline.",
        activities: [{ title: "Wired cognee add/cognify", status: "done" }],
        learnings: ["postgres.js returns json columns as arrays"],
        blockers: [],
        next_steps: ["Add chatgpt connector tests"],
        blog_candidates: ["How to ingest daily activity exports"],
      },
    ]);

    const connector = new ChatGptConnector({ date: "2026-09-12" });
    const row = await connector.getDailyActivity();

    expect(row).not.toBeNull();
    expect(row!.summary).toBe("Shipped the ingestion pipeline.");
    expect(endMock).toHaveBeenCalledTimes(1);
    expect(postgres).toHaveBeenCalledWith(
      "postgres://user:pass@localhost:5432/test",
      { prepare: false },
    );
  });

  it("returns null when no row exists", async () => {
    sqlMock.mockResolvedValue([]);

    const connector = new ChatGptConnector({ date: "2026-09-12" });
    const row = await connector.getDailyActivity();

    expect(row).toBeNull();
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it("throws on fetch when no row exists", async () => {
    sqlMock.mockResolvedValue([]);

    const connector = new ChatGptConnector({ date: "2026-09-12" });

    await expect(connector.fetch()).rejects.toThrow(/no daily activity found/);
  });

  it("throws without a DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;

    const connector = new ChatGptConnector({ date: "2026-09-12" });

    await expect(connector.getDailyActivity()).rejects.toThrow(/DATABASE_URL is required/);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("closes the connection even when the query rejects", async () => {
    sqlMock.mockRejectedValue(new Error("connection refused"));

    const connector = new ChatGptConnector({ date: "2026-09-12" });

    await expect(connector.getDailyActivity()).rejects.toThrow("connection refused");
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it("fetch() output parses through the ChatGptAdapter", async () => {
    sqlMock.mockResolvedValue([
      {
        date: "2026-09-12",
        source: "chatgpt",
        summary: "Shipped the ingestion pipeline.",
        activities: ["Wired cognee add/cognify"],
        learnings: [],
        blockers: null,
        next_steps: ["Add tests"],
        blog_candidates: [],
      },
    ]);

    const connector = new ChatGptConnector({ date: "2026-09-12" });
    const raw = await connector.fetch();
    const documents = new ChatGptAdapter().adapt(raw);

    expect(documents).toHaveLength(1);
    expect(documents[0].id).toBe("chatgpt-daily-2026-09-12");
    expect(documents[0].sourceType).toBe("chatgpt");
    expect(documents[0].title).toBe("Shipped the ingestion pipeline.");
    expect(documents[0].timestamp).toBe("2026-09-12T00:00:00.000Z");
    expect(documents[0].content).toContain("Summary: Shipped the ingestion pipeline.");
    expect(documents[0].content).toContain("Activities: - Wired cognee add/cognify");
    expect(documents[0].content).toContain("Next steps: - Add tests");
    expect(documents[0].metadata).toEqual({
      conversationId: "chatgpt-daily-2026-09-12",
      messageCount: 3,
    });
  });

  it("skips empty sections and throws when a row is entirely empty", async () => {
    sqlMock.mockResolvedValue([
      {
        date: "2026-09-12",
        source: "chatgpt",
        summary: null,
        activities: [],
        learnings: [],
        blockers: [],
        next_steps: [],
        blog_candidates: [],
      },
    ]);

    const connector = new ChatGptConnector({ date: "2026-09-12" });

    await expect(connector.fetch()).rejects.toThrow(/no summary and no items/);
  });

  it("falls back to a generated title when summary is missing but items exist", async () => {
    sqlMock.mockResolvedValue([
      {
        date: "2026-09-12",
        source: "chatgpt",
        summary: null,
        activities: ["One activity"],
        learnings: [],
        blockers: [],
        next_steps: [],
        blog_candidates: [],
      },
    ]);

    const connector = new ChatGptConnector({ date: "2026-09-12" });
    const raw = await connector.fetch();
    const documents = new ChatGptAdapter().adapt(raw);

    expect(documents[0].title).toBe("ChatGPT activity 2026-09-12");
  });
});
