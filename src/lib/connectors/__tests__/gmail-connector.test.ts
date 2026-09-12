import { describe, it, expect, vi, beforeEach } from "vitest";
import { GmailConnector } from "../gmail-connector";
import { EmailAdapter } from "../../adapters/email-adapter";

const mockAccessToken = "mock-access-token-xyz";

function base64UrlEncode(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function mockGmailMessage(overrides: {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
}) {
  return {
    id: overrides.id,
    threadId: overrides.threadId,
    snippet: overrides.body.slice(0, 100),
    payload: {
      headers: [
        { name: "From", value: overrides.from },
        { name: "To", value: overrides.to },
        { name: "Subject", value: overrides.subject },
        { name: "Date", value: overrides.date },
      ],
      mimeType: "text/plain",
      body: { data: base64UrlEncode(overrides.body) },
    },
  };
}

const message1 = mockGmailMessage({
  id: "msg-001",
  threadId: "thread-abc",
  from: "alice@example.com",
  to: "bob@example.com",
  subject: "Sprint review notes",
  body: "Here are the notes from today's sprint review. We shipped 3 features.",
  date: "Thu, 11 Sep 2026 14:00:00 +0000",
});

const message2 = mockGmailMessage({
  id: "msg-002",
  threadId: "thread-abc",
  from: "bob@example.com",
  to: "alice@example.com",
  subject: "Re: Sprint review notes",
  body: "Thanks! The auth refactor looks great.",
  date: "Thu, 11 Sep 2026 15:00:00 +0000",
});

const message3 = mockGmailMessage({
  id: "msg-003",
  threadId: "thread-xyz",
  from: "ci@example.com",
  to: "alice@example.com",
  subject: "Build #442 passed",
  body: "Pipeline succeeded. All 142 tests green.",
  date: "Fri, 12 Sep 2026 09:00:00 +0000",
});

describe("GmailConnector", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  function setupTokenRefresh() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({ access_token: mockAccessToken }),
    });
  }

  function setupMessageList() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          messages: [
            { id: "msg-001" },
            { id: "msg-002" },
            { id: "msg-003" },
          ],
        }),
    });
  }

  function setupMessageDetail(msg: typeof message1) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(msg),
    });
  }

  it("fetches messages and produces valid EmailAdapter output", async () => {
    setupTokenRefresh();
    setupMessageList();
    setupMessageDetail(message1);
    setupMessageDetail(message2);
    setupMessageDetail(message3);

    const connector = new GmailConnector({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token",
    });

    const raw = await connector.fetch();
    const adapter = new EmailAdapter();
    const docs = adapter.adapt(raw);

    expect(docs.length).toBe(3);
    for (const doc of docs) {
      expect(doc.sourceType).toBe("email");
      expect(doc.participants.length).toBeGreaterThan(0);
    }
  });

  it("groups messages by threadId", async () => {
    setupTokenRefresh();
    setupMessageList();
    setupMessageDetail(message1);
    setupMessageDetail(message2);
    setupMessageDetail(message3);

    const connector = new GmailConnector({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token",
    });

    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);

    expect(parsed.threads.length).toBe(2);

    const threadAbc = parsed.threads.find(
      (t: { threadId: string }) => t.threadId === "thread-abc",
    );
    expect(threadAbc.messages.length).toBe(2);

    const threadXyz = parsed.threads.find(
      (t: { threadId: string }) => t.threadId === "thread-xyz",
    );
    expect(threadXyz.messages.length).toBe(1);
  });

  it("extracts plain text from message body", async () => {
    setupTokenRefresh();
    setupMessageList();
    setupMessageDetail(message1);
    setupMessageDetail(message2);
    setupMessageDetail(message3);

    const connector = new GmailConnector({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token",
    });

    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);
    const threadAbc = parsed.threads.find(
      (t: { threadId: string }) => t.threadId === "thread-abc",
    );

    const firstMsg = threadAbc.messages.find(
      (m: { messageId: string }) => m.messageId === "msg-001",
    );
    expect(firstMsg.body).toContain("sprint review");
    expect(firstMsg.from).toBe("alice@example.com");
    expect(firstMsg.to).toContain("bob@example.com");
  });

  it("throws when no refresh token is available", async () => {
    const connector = new GmailConnector({
      clientId: "test-client-id",
      clientSecret: "test-secret",
    });

    await expect(connector.fetch()).rejects.toThrow("No refresh token");
  });

  it("handles multipart MIME messages", async () => {
    setupTokenRefresh();

    const multipartMessage = {
      id: "msg-multipart",
      threadId: "thread-multi",
      snippet: "Multipart message preview",
      payload: {
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "To", value: "receiver@example.com" },
          { name: "Subject", value: "Multipart test" },
          { name: "Date", value: "Fri, 12 Sep 2026 12:00:00 +0000" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: base64UrlEncode("Plain text content here.") },
          },
          {
            mimeType: "text/html",
            body: { data: base64UrlEncode("<p>HTML content</p>") },
          },
        ],
      },
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({ messages: [{ id: "msg-multipart" }] }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(multipartMessage),
    });

    const connector = new GmailConnector({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token",
    });

    const raw = await connector.fetch();
    const parsed = JSON.parse(raw);
    const msg = parsed.threads[0].messages[0];

    expect(msg.body).toBe("Plain text content here.");
  });

  it("handles API errors gracefully", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({ access_token: mockAccessToken }),
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: { status: "PERMISSION_DENIED", message: "Gmail API not enabled" },
        }),
    });

    const connector = new GmailConnector({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token",
    });

    await expect(connector.fetch()).rejects.toThrow("Gmail API request failed");
  });
});
