import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CodexConnector } from "../codex-connector";
import { CodingAgentAdapter } from "../../adapters/coding-agent-adapter";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-connector-test-"));
  const sessionsDir = path.join(tmpDir, "sessions");
  await fs.mkdir(sessionsDir);

  const jsonlLines = [
    JSON.stringify({
      type: "task",
      description: "Fix the login bug",
      timestamp: "2026-09-10T10:00:00Z",
    }),
    JSON.stringify({
      role: "user",
      content: "Please fix the login bug in auth.ts",
      timestamp: "2026-09-10T10:01:00Z",
    }),
    JSON.stringify({
      role: "agent",
      content: "Fixed the null check in auth.ts login handler.",
      timestamp: "2026-09-10T10:15:00Z",
    }),
    JSON.stringify({
      role: "user",
      content: "Looks good, tests pass.",
      timestamp: "2026-09-10T10:30:00Z",
    }),
  ].join("\n");

  await fs.writeFile(path.join(sessionsDir, "session-abc123.jsonl"), jsonlLines);

  const secondJsonl = [
    JSON.stringify({
      role: "user",
      content: "Add pagination to the user list endpoint",
      timestamp: "2026-09-11T09:00:00Z",
    }),
    JSON.stringify({
      role: "agent",
      content: "Added limit/offset params to GET /users.",
      timestamp: "2026-09-11T09:20:00Z",
    }),
  ].join("\n");

  await fs.writeFile(path.join(sessionsDir, "session-def456.jsonl"), secondJsonl);
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("CodexConnector", () => {
  it("fetches and parses JSONL session files", async () => {
    const connector = new CodexConnector({
      sessionsDir: path.join(tmpDir, "sessions"),
    });

    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);

    expect(parsed.sessions).toBeDefined();
    expect(parsed.sessions.length).toBe(2);
  });

  it("produces output compatible with CodingAgentAdapter", async () => {
    const connector = new CodexConnector({
      sessionsDir: path.join(tmpDir, "sessions"),
    });

    const raw = await connector.fetch();
    const adapter = new CodingAgentAdapter();
    const docs = adapter.adapt(raw);

    expect(docs.length).toBe(2);
    for (const doc of docs) {
      expect(doc.sourceType).toBe("coding_agent");
      expect(doc.participants.length).toBeGreaterThan(0);
      expect(doc.content.length).toBeGreaterThan(0);
    }
  });

  it("orders sessions by most recent first", async () => {
    const connector = new CodexConnector({
      sessionsDir: path.join(tmpDir, "sessions"),
    });

    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);
    const sessions = parsed.sessions;

    expect(sessions[0].transcript[0].timestamp).toBe("2026-09-11T09:00:00Z");
  });

  it("respects maxSessions option", async () => {
    const connector = new CodexConnector({
      sessionsDir: path.join(tmpDir, "sessions"),
      maxSessions: 1,
    });

    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);

    expect(parsed.sessions.length).toBe(1);
  });

  it("extracts roles and content from transcript entries", async () => {
    const connector = new CodexConnector({
      sessionsDir: path.join(tmpDir, "sessions"),
      maxSessions: 10,
    });

    const raw = await connector.fetch();
    const adapter = new CodingAgentAdapter();
    const docs = adapter.adapt(raw);

    const bugDoc = docs.find((d) => d.content.includes("login bug"));
    expect(bugDoc).toBeDefined();
    expect(bugDoc!.content).toContain("User:");
    expect(bugDoc!.content).toContain("Agent:");
  });

  it("throws when no session files exist", async () => {
    const emptyDir = path.join(tmpDir, "empty");
    await fs.mkdir(emptyDir);

    const connector = new CodexConnector({ sessionsDir: emptyDir });
    await expect(connector.fetch()).rejects.toThrow("no session files found");
  });

  it("handles alternate JSONL field names", async () => {
    const altDir = path.join(tmpDir, "alt-sessions");
    await fs.mkdir(altDir);

    const altJsonl = [
      JSON.stringify({
        author: "developer",
        text: "Refactor the parser module",
        ts: "2026-09-12T08:00:00Z",
      }),
      JSON.stringify({
        author: "assistant",
        text: "Refactored parser into separate lexer and tokenizer.",
        ts: "2026-09-12T08:30:00Z",
      }),
    ].join("\n");

    await fs.writeFile(path.join(altDir, "session-alt.jsonl"), altJsonl);

    const connector = new CodexConnector({ sessionsDir: altDir });
    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);

    expect(parsed.sessions.length).toBe(1);
    expect(parsed.sessions[0].transcript[0].role).toBe("developer");
    expect(parsed.sessions[0].transcript[0].content).toBe("Refactor the parser module");
  });

  it("handles current Codex envelope records", async () => {
    const envelopeDir = path.join(tmpDir, "envelope-sessions");
    await fs.mkdir(envelopeDir);

    const envelopeJsonl = [
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-09-12T15:00:00Z",
        payload: {
          cwd: path.join("C:", "Documents", "Code", "Yap2Graph"),
          session_id: "session-envelope",
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-09-12T15:01:00Z",
        payload: {
          type: "user_message",
          message: "Why is live ingestion failing?",
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-09-12T15:02:00Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "The connector needs to parse nested payload records.",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-09-12T15:03:00Z",
        payload: {
          type: "agent_message",
          message: "Patched the parser and added coverage.",
        },
      }),
    ].join("\n");

    await fs.writeFile(
      path.join(envelopeDir, "rollout-session-envelope.jsonl"),
      envelopeJsonl,
    );

    const connector = new CodexConnector({ sessionsDir: envelopeDir });
    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);

    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].repo).toBe("Yap2Graph");
    expect(parsed.sessions[0].task).toBe("Why is live ingestion failing?");
    expect(parsed.sessions[0].transcript).toEqual([
      {
        role: "user",
        content: "Why is live ingestion failing?",
        timestamp: "2026-09-12T15:01:00Z",
      },
      {
        role: "agent",
        content: "The connector needs to parse nested payload records.",
        timestamp: "2026-09-12T15:02:00Z",
      },
      {
        role: "agent",
        content: "Patched the parser and added coverage.",
        timestamp: "2026-09-12T15:03:00Z",
      },
    ]);
  });
});
