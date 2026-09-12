import http from "node:http";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

interface GmailMessage {
  id: string;
  threadId: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailPart[];
    mimeType?: string;
    body?: { data?: string };
  };
  snippet?: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailThread {
  threadId: string;
  subject: string;
  messages: Array<{
    messageId: string;
    from: string;
    to: string[];
    date: string;
    subject: string;
    body: string;
  }>;
}

export interface GmailConnectorOptions {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  refreshToken?: string;
  maxMessages?: number;
}

export class GmailConnector {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private refreshToken: string | null;
  private readonly maxMessages: number;

  constructor(options: GmailConnectorOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri =
      options.redirectUri ?? "http://localhost:3000/auth/google/callback";
    this.refreshToken = options.refreshToken ?? null;
    this.maxMessages = options.maxMessages ?? 20;
  }

  async fetch(): Promise<string> {
    const accessToken = await this.getAccessToken();
    const messages = await this.fetchMessages(accessToken);
    const threads = this.groupByThread(messages);
    return JSON.stringify({ threads });
  }

  async authenticateInteractive(): Promise<string> {
    const state = crypto.randomBytes(24).toString("hex");
    const parsed = new URL(this.redirectUri);
    const port = Number(parsed.port);
    const host = parsed.hostname === "[::1]" ? "::1" : parsed.hostname;

    const code = await new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const requestUrl = new URL(
          req.url ?? "/",
          `http://${parsed.host}`,
        );

        if (requestUrl.pathname === "/") {
          const authPath = "/auth/google";
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><html><body><p>Open <a href="${authPath}">${authPath}</a> to start Gmail OAuth.</p></body></html>`,
          );
          return;
        }

        if (requestUrl.pathname === "/auth/google") {
          res.writeHead(302, { location: this.buildAuthUrl(state) });
          res.end();
          return;
        }

        if (requestUrl.pathname === parsed.pathname) {
          const oauthError = requestUrl.searchParams.get("error");
          if (oauthError) {
            reject(new Error(`OAuth failure: ${oauthError}`));
            res.writeHead(400);
            res.end("OAuth failed");
            server.close();
            return;
          }
          if (requestUrl.searchParams.get("state") !== state) {
            reject(new Error("OAuth state mismatch"));
            res.writeHead(400);
            res.end("State mismatch");
            server.close();
            return;
          }
          const authCode = requestUrl.searchParams.get("code");
          if (!authCode) {
            reject(new Error("No authorization code received"));
            res.writeHead(400);
            res.end("No code");
            server.close();
            return;
          }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            "<!doctype html><html><body><p>Authenticated. Return to terminal.</p></body></html>",
          );
          setTimeout(() => server.close(), 250);
          resolve(authCode);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });

      server.once("error", reject);
      server.listen(port, host);
    });

    const tokens = await this.exchangeCode(code);
    if (tokens.refresh_token) {
      this.refreshToken = tokens.refresh_token;
    }
    return tokens.refresh_token ?? "";
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  private buildAuthUrl(state: string): string {
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GMAIL_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  private async exchangeCode(
    code: string,
  ): Promise<{ access_token: string; refresh_token?: string }> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }),
    });

    const data = await this.readJson(response);
    if (!response.ok) {
      throw new Error(
        `Token exchange failed (${response.status}): ${this.describeError(data)}`,
      );
    }
    if (!data.access_token) {
      throw new Error("Token exchange succeeded but no access token returned.");
    }
    return data;
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error(
        "No refresh token available. Run authenticateInteractive() first.",
      );
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = await this.readJson(response);
    if (!response.ok) {
      throw new Error(
        `Token refresh failed (${response.status}): ${this.describeError(data)}`,
      );
    }
    if (!data.access_token) {
      throw new Error("Token refresh succeeded but no access token returned.");
    }
    return data.access_token;
  }

  private async getAccessToken(): Promise<string> {
    return this.refreshAccessToken();
  }

  private async fetchMessages(accessToken: string): Promise<GmailMessage[]> {
    const listUrl = new URL(`${GMAIL_API_BASE}/messages`);
    listUrl.searchParams.set("maxResults", String(this.maxMessages));
    listUrl.searchParams.set("q", "in:anywhere");

    const listed = await this.gmailFetch<{
      messages?: Array<{ id: string }>;
    }>(listUrl.toString(), accessToken);
    const messageIds = listed.messages ?? [];

    const messages: GmailMessage[] = [];
    for (const msg of messageIds) {
      const getUrl = new URL(`${GMAIL_API_BASE}/messages/${msg.id}`);
      getUrl.searchParams.set("format", "full");
      messages.push(await this.gmailFetch<GmailMessage>(getUrl.toString(), accessToken));
    }
    return messages;
  }

  private groupByThread(messages: GmailMessage[]): GmailThread[] {
    const threadMap = new Map<string, GmailMessage[]>();

    for (const msg of messages) {
      const threadId = msg.threadId;
      const existing = threadMap.get(threadId) ?? [];
      existing.push(msg);
      threadMap.set(threadId, existing);
    }

    const threads: GmailThread[] = [];
    for (const [threadId, msgs] of threadMap) {
      const parsedMessages = msgs.map((msg) => this.parseMessage(msg));
      const subject =
        parsedMessages[0]?.subject || `Thread ${threadId}`;
      threads.push({ threadId, subject, messages: parsedMessages });
    }

    return threads;
  }

  private parseMessage(msg: GmailMessage): GmailThread["messages"][number] {
    const headers = this.headersByName(msg.payload?.headers ?? []);
    const body = this.extractPlainText(msg.payload) || msg.snippet || "";

    const toHeader = headers.to ?? "";
    const toList = toHeader
      .split(",")
      .map((addr: string) => addr.trim())
      .filter(Boolean);

    const date = headers.date
      ? this.toIsoTimestamp(headers.date)
      : new Date().toISOString();

    return {
      messageId: msg.id,
      from: headers.from ?? "unknown",
      to: toList.length > 0 ? toList : ["unknown"],
      date,
      subject: headers.subject ?? "(no subject)",
      body,
    };
  }

  private headersByName(
    headers: Array<{ name: string; value: string }>,
  ): Record<string, string> {
    return headers.reduce<Record<string, string>>((acc, h) => {
      acc[h.name.toLowerCase()] = h.value;
      return acc;
    }, {});
  }

  private extractPlainText(payload?: {
    parts?: GmailPart[];
    mimeType?: string;
    body?: { data?: string };
  }): string {
    if (!payload) return "";
    const part = this.findPart(payload, (p) => p.mimeType === "text/plain" && !!p.body?.data);
    if (!part) return "";
    return this.decodeBase64Url(part.body!.data!);
  }

  private findPart(
    part: GmailPart,
    predicate: (p: GmailPart) => boolean,
  ): GmailPart | null {
    if (predicate(part)) return part;
    for (const child of part.parts ?? []) {
      const found = this.findPart(child, predicate);
      if (found) return found;
    }
    return null;
  }

  private decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  }

  private toIsoTimestamp(dateHeader: string): string {
    const parsed = new Date(dateHeader);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  private async gmailFetch<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const data = await this.readJson(response);
    if (!response.ok) {
      throw new Error(
        `Gmail API request failed (${response.status}): ${this.describeError(data)}`,
      );
    }
    return data as T;
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error_description: text };
    }
  }

  private describeError(data: Record<string, unknown>): string {
    const error = data.error as Record<string, unknown> | undefined;
    const status = error?.status;
    const errors = error?.errors as Array<{ reason?: string }> | undefined;
    const reason = errors?.[0]?.reason;
    const message =
      (error?.message as string) ??
      (data.error_description as string) ??
      (data.error as string) ??
      "Unknown error";
    return [status, reason, message].filter(Boolean).join(" - ");
  }
}
