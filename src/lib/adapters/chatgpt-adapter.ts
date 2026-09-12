import { z } from "zod";
import { SourceDocument } from "../schemas";
import type { SourceAdapter } from "./types";

const RawChatGptExport = z.object({
  conversations: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        create_time: z.number(),
        messages: z
          .array(
            z.object({
              author: z.object({ role: z.string().min(1) }),
              content: z.string(),
              create_time: z.number().nullable(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export class ChatGptAdapter implements SourceAdapter {
  readonly sourceType = "chatgpt" as const;

  adapt(rawExport: string): SourceDocument[] {
    let parsed: z.infer<typeof RawChatGptExport>;
    try {
      parsed = RawChatGptExport.parse(JSON.parse(rawExport));
    } catch (err) {
      throw new Error(
        `ChatGptAdapter: invalid raw export — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return parsed.conversations.map((conv): SourceDocument => {
      const docId = this.computeDocId(conv.id);
      const timestamp = this.isoFromEpoch(conv.create_time);
      const participants = this.uniqueParticipants(conv.messages);
      const content = conv.messages
        .map(
          (m) =>
            `${m.author.role.charAt(0).toUpperCase() + m.author.role.slice(1)}: ${m.content}`,
        )
        .join("\n\n");

      return SourceDocument.parse({
        id: docId,
        sourceType: "chatgpt",
        title: conv.title,
        timestamp,
        participants,
        content,
        metadata: {
          conversationId: conv.id,
          messageCount: conv.messages.length,
        },
      });
    });
  }

  private computeDocId(conversationId: string): string {
    return conversationId.startsWith("chatgpt-")
      ? conversationId
      : `chatgpt-${conversationId}`;
  }

  private isoFromEpoch(epochSeconds: number): string {
    return new Date(epochSeconds * 1000).toISOString();
  }

  private uniqueParticipants(
    messages: Array<{ author: { role: string } }>,
  ): string[] {
    return [...new Set(messages.map((m) => m.author.role))];
  }
}
