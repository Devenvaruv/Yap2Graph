import { z } from "zod";
import { SourceDocument } from "../schemas";
import type { SourceAdapter } from "./types";

const RawCodingAgentExport = z.object({
  sessions: z
    .array(
      z.object({
        sessionId: z.string().min(1),
        agent: z.string().min(1),
        repo: z.string().min(1),
        startTime: z.string().datetime({ offset: true }),
        endTime: z.string().datetime({ offset: true }),
        task: z.string().min(1),
        transcript: z
          .array(
            z.object({
              role: z.string().min(1),
              content: z.string().min(1),
              timestamp: z.string().datetime({ offset: true }),
            }),
          )
          .min(1),
        filesChanged: z.number().int().min(0),
        testsAdded: z.number().int().min(0),
      }),
    )
    .min(1),
});

export class CodingAgentAdapter implements SourceAdapter {
  readonly sourceType = "coding_agent" as const;

  adapt(rawExport: string): SourceDocument[] {
    let parsed: z.infer<typeof RawCodingAgentExport>;
    try {
      parsed = RawCodingAgentExport.parse(JSON.parse(rawExport));
    } catch (err) {
      throw new Error(
        `CodingAgentAdapter: invalid raw export — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return parsed.sessions.map((session): SourceDocument => {
      const participants = this.uniqueParticipants(session.transcript);
      const content = session.transcript
        .map(
          (t) =>
            `${t.role.charAt(0).toUpperCase() + t.role.slice(1)}: ${t.content}`,
        )
        .join("\n\n");

      return SourceDocument.parse({
        id: this.computeDocId(session.sessionId),
        sourceType: "coding_agent",
        title: `Codex session: ${session.task}`,
        timestamp: session.startTime,
        participants,
        content,
        metadata: {
          agent: session.agent,
          sessionId: session.sessionId,
          repo: session.repo,
          endTime: session.endTime,
          filesChanged: session.filesChanged,
          testsAdded: session.testsAdded,
        },
      });
    });
  }

  private computeDocId(sessionId: string): string {
    return sessionId.startsWith("codex-") ? sessionId : `codex-${sessionId}`;
  }

  private uniqueParticipants(
    transcript: Array<{ role: string }>,
  ): string[] {
    return [...new Set(transcript.map((t) => t.role))];
  }
}
