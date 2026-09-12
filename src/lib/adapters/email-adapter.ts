import { z } from "zod";
import { SourceDocument } from "../schemas";
import type { SourceAdapter } from "./types";

const RawEmailExport = z.object({
  threads: z
    .array(
      z.object({
        threadId: z.string().min(1),
        subject: z.string().min(1),
        messages: z
          .array(
            z.object({
              messageId: z.string().min(1),
              from: z.string().min(1),
              to: z.array(z.string().min(1)).min(1),
              date: z.string().datetime({ offset: true }),
              subject: z.string().min(1),
              body: z.string().min(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export class EmailAdapter implements SourceAdapter {
  readonly sourceType = "email" as const;

  adapt(rawExport: string): SourceDocument[] {
    let parsed: z.infer<typeof RawEmailExport>;
    try {
      parsed = RawEmailExport.parse(JSON.parse(rawExport));
    } catch (err) {
      throw new Error(
        `EmailAdapter: invalid raw export — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const documents: SourceDocument[] = [];

    for (const thread of parsed.threads) {
      for (const msg of thread.messages) {
        documents.push(
          SourceDocument.parse({
            id: this.computeDocId(msg.messageId),
            sourceType: "email",
            title: msg.subject,
            timestamp: msg.date,
            participants: [msg.from, ...msg.to],
            content: `From: ${msg.from}\nTo: ${msg.to.join("; ")}\nSubject: ${msg.subject}\n\n${msg.body}`,
            metadata: {
              from: msg.from,
              to: msg.to,
              threadId: thread.threadId,
            },
          }),
        );
      }
    }

    return documents;
  }

  private computeDocId(messageId: string): string {
    return messageId.startsWith("email-") ? messageId : `email-${messageId}`;
  }
}
