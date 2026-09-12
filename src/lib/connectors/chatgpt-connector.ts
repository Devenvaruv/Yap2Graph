import postgres from "postgres";

export interface DailyActivityRow {
  date: string | Date;
  source: string;
  summary: string | null;
  activities: unknown[] | null;
  learnings: unknown[] | null;
  blockers: unknown[] | null;
  next_steps: unknown[] | null;
  blog_candidates: unknown[] | null;
}

export interface ChatGptConnectorOptions {
  /** Postgres connection string; falls back to process.env.DATABASE_URL. */
  databaseUrl?: string;
  /** Activity day to fetch, as YYYY-MM-DD. */
  date: string;
  /** Row source column to match; defaults to "chatgpt". */
  source?: string;
}

interface ChatGptMessage {
  author: { role: string };
  content: string;
  create_time: number | null;
}

export class ChatGptConnector {
  private readonly databaseUrl: string;
  private readonly date: string;
  private readonly source: string;

  constructor(options: ChatGptConnectorOptions) {
    this.databaseUrl = (options.databaseUrl ?? process.env.DATABASE_URL ?? "").trim();
    this.date = options.date;
    this.source = options.source ?? "chatgpt";
  }

  async getDailyActivity(): Promise<DailyActivityRow | null> {
    if (!this.databaseUrl) {
      throw new Error(
        "ChatGptConnector: DATABASE_URL is required (set it in .env or pass databaseUrl).",
      );
    }

    const sql = postgres(this.databaseUrl, { prepare: false });
    try {
      const [row] = await sql`
        SELECT *
        FROM daily_activities
        WHERE date = ${this.date}
          AND source = ${this.source}
        LIMIT 1;
      `;
      return (row as DailyActivityRow | undefined) ?? null;
    } finally {
      await sql.end();
    }
  }

  async fetch(): Promise<string> {
    const row = await this.getDailyActivity();
    if (!row) {
      throw new Error(
        `ChatGptConnector: no daily activity found for ${this.date} (source "${this.source}").`,
      );
    }
    return dailyActivityToChatGptExport(row);
  }
}

/**
 * Map one daily_activities row to the ChatGPT export shape consumed by
 * ChatGptAdapter: one conversation whose messages are the summary plus each
 * non-empty section, so section names survive as participants and the rendered
 * transcript reads "Summary: ... / Activities: - ...".
 */
export function dailyActivityToChatGptExport(row: DailyActivityRow): string {
  const date = normalizeDate(row.date);
  const create_time = Date.parse(`${date}T00:00:00Z`) / 1000;
  if (Number.isNaN(create_time)) {
    throw new Error(
      `ChatGptConnector: daily_activities row has an unparseable date: ${String(row.date)}`,
    );
  }

  const messages: ChatGptMessage[] = [];
  const summary = row.summary?.trim() ?? "";
  if (summary) {
    messages.push({
      author: { role: "summary" },
      content: row.summary!,
      create_time: null,
    });
  }

  const sections: Array<[string, unknown[] | null]> = [
    ["activities", row.activities],
    ["learnings", row.learnings],
    ["blockers", row.blockers],
    ["next steps", row.next_steps],
    ["blog candidates", row.blog_candidates],
  ];
  for (const [role, items] of sections) {
    if (!Array.isArray(items) || items.length === 0) continue;
    messages.push({
      author: { role },
      content: items.map(renderItem).map((line) => `- ${line}`).join("\n"),
      create_time: null,
    });
  }

  if (messages.length === 0) {
    throw new Error(
      `ChatGptConnector: daily activity ${date} has no summary and no items.`,
    );
  }

  return JSON.stringify({
    conversations: [
      {
        id: `chatgpt-daily-${date}`,
        title: summary || `ChatGPT activity ${date}`,
        create_time,
        messages,
      },
    ],
  });
}

function normalizeDate(date: string | Date): string {
  if (typeof date === "string") return date;
  return date.toISOString().slice(0, 10);
}

function renderItem(item: unknown): string {
  return typeof item === "string" ? item : JSON.stringify(item);
}
