import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CodexSession {
  sessionId: string;
  agent: string;
  repo: string;
  startTime: string;
  endTime: string;
  task: string;
  transcript: Array<{ role: string; content: string; timestamp: string }>;
  filesChanged: number;
  testsAdded: number;
}

export interface CodexConnectorOptions {
  sessionsDir?: string;
  maxSessions?: number;
}

export class CodexConnector {
  private readonly sessionsDir: string;
  private readonly maxSessions: number;

  constructor(options: CodexConnectorOptions = {}) {
    this.sessionsDir =
      options.sessionsDir ?? path.join(os.homedir(), ".codex", "sessions");
    this.maxSessions = options.maxSessions ?? 10;
  }

  async fetch(): Promise<string> {
    const sessionFiles = await this.findJsonlFiles(this.sessionsDir);
    if (sessionFiles.length === 0) {
      throw new Error(
        `CodexConnector: no session files found in ${this.sessionsDir}`,
      );
    }

    const filesWithStats = await Promise.all(
      sessionFiles.map(async (file) => ({
        file,
        stat: await fs.stat(file),
      })),
    );

    const sorted = filesWithStats.sort(
      (a, b) => b.stat.mtimeMs - a.stat.mtimeMs,
    );
    const selected = sorted.slice(0, this.maxSessions);

    const sessions: CodexSession[] = [];
    for (const entry of selected) {
      const session = await this.parseSessionFile(entry.file);
      if (session) sessions.push(session);
    }

    if (sessions.length === 0) {
      throw new Error(
        "CodexConnector: no valid sessions found in any session file",
      );
    }

    return JSON.stringify({ sessions });
  }

  private async findJsonlFiles(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.findJsonlFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private async parseSessionFile(
    filePath: string,
  ): Promise<CodexSession | null> {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());

    const transcript: Array<{
      role: string;
      content: string;
      timestamp: string;
    }> = [];
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let task = "";

    for (const line of lines) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      const ts = this.extractTimestamp(record);
      if (ts) {
        if (!firstTimestamp) firstTimestamp = ts;
        lastTimestamp = ts;
      }

      const role = this.extractRole(record);
      const text = this.extractContent(record);
      if (role && text) {
        transcript.push({
          role,
          content: text,
          timestamp: ts ?? new Date().toISOString(),
        });
      }

      if (!task && record.type === "task") {
        task = String(record.description ?? record.task ?? "");
      }
    }

    if (transcript.length === 0) return null;

    const sessionId = path.basename(filePath, ".jsonl");
    const fallbackTs = firstTimestamp ?? new Date().toISOString();

    return {
      sessionId: `codex-${sessionId}`,
      agent: "codex-cli",
      repo: this.inferRepo(filePath),
      startTime: fallbackTs,
      endTime: lastTimestamp ?? fallbackTs,
      task: task || `Codex session ${sessionId.slice(0, 8)}`,
      transcript,
      filesChanged: 0,
      testsAdded: 0,
    };
  }

  private extractTimestamp(record: Record<string, unknown>): string | null {
    if (typeof record.timestamp === "string") return record.timestamp;
    if (typeof record.ts === "string") return record.ts;
    if (typeof record.created_at === "string") return record.created_at;
    if (typeof record.time === "string") return record.time;
    if (typeof record.timestamp === "number") {
      return new Date(record.timestamp * 1000).toISOString();
    }
    return null;
  }

  private extractRole(record: Record<string, unknown>): string | null {
    if (typeof record.role === "string") return record.role;
    if (typeof record.author === "string") return record.author;
    if (
      record.author &&
      typeof record.author === "object" &&
      typeof (record.author as Record<string, unknown>).role === "string"
    ) {
      return (record.author as Record<string, string>).role;
    }
    if (typeof record.type === "string") {
      const typeMap: Record<string, string> = {
        message: "user",
        response: "agent",
        assistant: "agent",
        user: "user",
      };
      return typeMap[record.type] ?? null;
    }
    return null;
  }

  private extractContent(record: Record<string, unknown>): string | null {
    if (typeof record.content === "string") return record.content;
    if (typeof record.text === "string") return record.text;
    if (typeof record.message === "string") return record.message;
    if (Array.isArray(record.content)) {
      return record.content
        .filter(
          (part: unknown) =>
            typeof part === "string" ||
            (typeof part === "object" && part !== null),
        )
        .map((part: unknown) =>
          typeof part === "string" ? part : JSON.stringify(part),
        )
        .join("\n");
    }
    return null;
  }

  private inferRepo(filePath: string): string {
    const parts = filePath.split(path.sep);
    const sessionsIdx = parts.indexOf("sessions");
    if (sessionsIdx > 0) {
      const codexIdx = sessionsIdx - 1;
      if (codexIdx > 0 && parts[codexIdx] === ".codex") {
        const beforeCodex = parts[codexIdx - 1];
        return beforeCodex || "unknown";
      }
    }
    return "unknown";
  }
}
