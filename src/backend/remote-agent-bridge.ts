import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_APP_VERSION_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol";
import {
  REMOTE_AGENT_BRIDGE_INVITE_LIFETIME_MS,
  REMOTE_AGENT_BRIDGE_ROUTES,
} from "@openbot/contracts/team-protocol/remote-agent-bridge-v1";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";

export class RemoteAgentBridgeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RemoteAgentBridgeCipher {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export interface RemoteAgentBridgeInvite {
  inviteId: string;
  code: string;
  expiresAt: string;
  serverName: string;
}

export interface RemoteAgentBridgeLink {
  linkId: string;
  peerName: string;
  peerReach: string;
  createdAt: string;
}

export interface RemoteAgentBridgeAgent {
  id: string;
  name: string;
}

interface InviteRow {
  invite_id: string;
  secret_hash: string;
  expires_at: string;
  reach: string;
  server_name: string;
  created_at: string;
  used_at: string | null;
}

interface LinkRow {
  link_id: string;
  peer_name: string;
  peer_reach: string;
  peer_token_hash: string;
  token_ciphertext: Buffer;
  created_at: string;
  revoked_at: string | null;
}

function isInviteListRow(value: unknown): value is { invite_id: string; expires_at: string; server_name: string } {
  return (
    isDynamicRecord(value) &&
    typeof value.invite_id === "string" &&
    typeof value.expires_at === "string" &&
    typeof value.server_name === "string"
  );
}

function isLinkListRow(value: unknown): value is Pick<LinkRow, "link_id" | "peer_name" | "peer_reach" | "created_at"> {
  return (
    isDynamicRecord(value) &&
    typeof value.link_id === "string" &&
    typeof value.peer_name === "string" &&
    typeof value.peer_reach === "string" &&
    typeof value.created_at === "string"
  );
}

function isInviteRow(value: unknown): value is InviteRow {
  return (
    isDynamicRecord(value) &&
    typeof value.invite_id === "string" &&
    typeof value.secret_hash === "string" &&
    typeof value.expires_at === "string" &&
    typeof value.reach === "string" &&
    typeof value.server_name === "string" &&
    typeof value.created_at === "string" &&
    (value.used_at === null || typeof value.used_at === "string")
  );
}

function isLinkRow(value: unknown): value is LinkRow {
  return (
    isDynamicRecord(value) &&
    typeof value.link_id === "string" &&
    typeof value.peer_name === "string" &&
    typeof value.peer_reach === "string" &&
    typeof value.peer_token_hash === "string" &&
    (Buffer.isBuffer(value.token_ciphertext) || value.token_ciphertext instanceof Uint8Array) &&
    typeof value.created_at === "string" &&
    (value.revoked_at === null || typeof value.revoked_at === "string")
  );
}

function readRows<T>(rows: unknown, guard: (value: unknown) => value is T): T[] {
  return Array.isArray(rows) ? rows.filter(guard) : [];
}

function decodeAcceptPayload(value: unknown): { token: string; serverName: string; linkId: string } {
  if (!isDynamicRecord(value) || typeof value.token !== "string" || typeof value.linkId !== "string") {
    throw new RemoteAgentBridgeError(502, sourceText("error.backend.remoteAgentBridgePeerDown"));
  }
  return {
    token: value.token,
    serverName: typeof value.serverName === "string" ? value.serverName : "",
    linkId: value.linkId,
  };
}

function decodeAgentPage(value: unknown): { agents: { id: string; name: string }[] } {
  if (!isDynamicRecord(value) || !Array.isArray(value.agents)) {
    throw new RemoteAgentBridgeError(502, sourceText("error.backend.remoteAgentBridgePeerDown"));
  }
  const agents = value.agents.flatMap((entry) =>
    isDynamicRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string"
      ? [{ id: entry.id, name: entry.name }]
      : [],
  );
  return { agents };
}

function decodeMessageReceipt(value: unknown): { messageId: string } {
  if (!isDynamicRecord(value) || typeof value.messageId !== "string") {
    throw new RemoteAgentBridgeError(502, sourceText("error.backend.remoteAgentBridgePeerDown"));
  }
  return { messageId: value.messageId };
}

function decodeVoidResponse(): void {}

interface InviteCode {
  v: 1;
  secret: string;
  reach: string;
  serverName: string;
  expiresAt: string;
}

interface BridgeFile {
  name: string;
  data: Buffer;
}

export interface RemoteAgentBridgeMessage {
  senderAgentId: string;
  senderAgentName: string;
  senderServerName: string;
  recipientAgentId: string;
  text: string;
  replyToMessageId?: string | null;
  files?: { name: string; data: string }[];
}

type BridgeEffect<A> = Effect.Effect<A, { cause: RemoteAgentBridgeError }>;

type RemoteAgentBridgeDialBody =
  | Record<string, never>
  | {
      secret: string;
      peerReach: string;
      peerName: string;
      peerToken: string;
    }
  | {
      senderAgentId: string;
      senderAgentName: string;
      senderServerName: string;
      recipientAgentId: string;
      text: string;
      replyToMessageId?: string;
      files: { name: string; data: string }[];
    };

interface RemoteAgentEnqueue {
  sender: {
    kind: "remote-agent";
    agentId: string;
    agentName: string;
    linkId: string;
    serverName: string;
  };
  recipientAgentIds: string[];
  text: string;
  replyToMessageId?: string | null;
  sourcePaths?: string[];
}

const DIAL_TIMEOUT_MS = 15_000;

function fail(status: number, message: string): BridgeEffect<never> {
  return Effect.fail({ cause: new RemoteAgentBridgeError(status, message) });
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function token(): string {
  const value = randomBytes(32).toString("base64url");
  registerSecretValue(value);
  return value;
}

function normalizeReach(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return trimmed.replace(/\/+$/u, "");
  }
}

export function parseRemoteAgentId(id: string): { linkId: string; agentId: string } | null {
  if (!id.startsWith("remote:") || id.length > 128) return null;
  const rest = id.slice("remote:".length);
  const split = rest.indexOf(":");
  if (split <= 0 || split === rest.length - 1) return null;
  return { linkId: rest.slice(0, split), agentId: rest.slice(split + 1) };
}

function remoteAgentId(linkId: string, agentId: string): string {
  return `remote:${linkId}:${agentId}`;
}

function encodeCode(code: InviteCode): string {
  registerSecretValue(code.secret, { allowShort: true });
  return Buffer.from(JSON.stringify(code), "utf8").toString("base64url");
}

function decodeCode(value: string): InviteCode | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isDynamicRecord(parsed)) return null;
    const record = parsed;
    if (
      record.v !== 1 ||
      typeof record.secret !== "string" ||
      typeof record.reach !== "string" ||
      typeof record.serverName !== "string" ||
      typeof record.expiresAt !== "string"
    )
      return null;
    registerSecretValue(record.secret, { allowShort: true });
    return {
      v: 1,
      secret: record.secret,
      reach: record.reach,
      serverName: record.serverName,
      expiresAt: record.expiresAt,
    };
  } catch {
    return null;
  }
}

export class RemoteAgentBridge {
  #reach = "";
  readonly #db: DatabaseSync;
  readonly #cipher: RemoteAgentBridgeCipher;
  readonly #listLocalAgents: () => { id: string; name: string }[];
  readonly #serverName: () => string;
  readonly #enqueue: (input: RemoteAgentEnqueue) => Effect.Effect<{ messageId: string }, { cause: unknown }>;
  readonly #now: () => number;

  constructor(options: {
    db: DatabaseSync;
    cipher: RemoteAgentBridgeCipher;
    listLocalAgents: () => { id: string; name: string }[];
    serverName: () => string;
    enqueue: (input: RemoteAgentEnqueue) => Effect.Effect<{ messageId: string }, { cause: unknown }>;
    now?: () => number;
  }) {
    this.#db = options.db;
    this.#cipher = options.cipher;
    this.#listLocalAgents = options.listLocalAgents;
    this.#serverName = options.serverName;
    this.#enqueue = options.enqueue;
    this.#now = options.now ?? Date.now;
  }

  setReach(reach: string): void {
    this.#reach = normalizeReach(reach);
  }

  reach(): string {
    return this.#reach;
  }

  createInvite = Effect.fn("RemoteAgentBridge.createInvite")(function* (
    this: RemoteAgentBridge,
    serverName: string,
  ): Effect.fn.Return<RemoteAgentBridgeInvite, { cause: RemoteAgentBridgeError }> {
    if (!this.#reach) return yield* fail(409, sourceText("error.backend.remoteAgentBridgePeerDown"));
    const secret = token();
    const inviteId = randomBytes(8).toString("hex");
    const createdAt = new Date(this.#now()).toISOString();
    const expiresAt = new Date(this.#now() + REMOTE_AGENT_BRIDGE_INVITE_LIFETIME_MS).toISOString();
    this.#db
      .prepare(
        `INSERT INTO remote_agent_bridge_invites
         (invite_id, secret_hash, expires_at, reach, server_name, created_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(inviteId, hashSecret(secret), expiresAt, this.#reach, serverName, createdAt);
    return {
      inviteId,
      code: encodeCode({ v: 1, secret, reach: this.#reach, serverName, expiresAt }),
      expiresAt,
      serverName,
    };
  });

  listInvites(): RemoteAgentBridgeInvite[] {
    const rows = readRows(
      this.#db
        .prepare(
          `SELECT invite_id, expires_at, server_name FROM remote_agent_bridge_invites
         WHERE used_at IS NULL ORDER BY created_at`,
        )
        .all(),
      isInviteListRow,
    );
    return rows.map((row) => ({
      inviteId: row.invite_id,
      code: "",
      expiresAt: row.expires_at,
      serverName: row.server_name,
    }));
  }

  revokeInvite(inviteId: string): void {
    this.#db.prepare("DELETE FROM remote_agent_bridge_invites WHERE invite_id = ? AND used_at IS NULL").run(inviteId);
  }

  listLinks(): RemoteAgentBridgeLink[] {
    const rows = readRows(
      this.#db
        .prepare(
          `SELECT link_id, peer_name, peer_reach, created_at FROM remote_agent_bridge_links
         WHERE revoked_at IS NULL ORDER BY created_at`,
        )
        .all(),
      isLinkListRow,
    );
    return rows.map((row) => ({
      linkId: row.link_id,
      peerName: row.peer_name,
      peerReach: row.peer_reach,
      createdAt: row.created_at,
    }));
  }

  redeem = Effect.fn("RemoteAgentBridge.redeem")(function* (
    this: RemoteAgentBridge,
    codeText: string,
    serverName: string,
  ): Effect.fn.Return<RemoteAgentBridgeLink, { cause: RemoteAgentBridgeError }> {
    const code = decodeCode(codeText);
    if (!code) return yield* fail(401, sourceText("error.backend.remoteAgentBridgeInviteUsed"));
    if (normalizeReach(code.reach) === this.#reach)
      return yield* fail(409, sourceText("error.backend.remoteAgentBridgeSameServer"));
    if (Date.parse(code.expiresAt) <= this.#now())
      return yield* fail(409, sourceText("error.backend.remoteAgentBridgeInviteExpired"));
    const peerToken = token();
    const accepted = yield* this.#dial(
      {
        reach: code.reach,
        token: null,
        method: "POST",
        path: REMOTE_AGENT_BRIDGE_ROUTES.accept,
        body: { secret: code.secret, peerReach: this.#reach, peerName: serverName, peerToken },
      },
      decodeAcceptPayload,
    );
    registerSecretValue(accepted.token);
    return this.#insertLink({
      peerName: accepted.serverName || code.serverName,
      peerReach: code.reach,
      incomingToken: accepted.token,
      outgoingToken: peerToken,
    });
  });

  accept = Effect.fn("RemoteAgentBridge.accept")(function* (
    this: RemoteAgentBridge,
    body: { secret: string; peerReach: string; peerName: string; peerToken: string },
  ): Effect.fn.Return<{ token: string; serverName: string; linkId: string }, { cause: RemoteAgentBridgeError }> {
    registerSecretValue(body.secret, { allowShort: true });
    registerSecretValue(body.peerToken);
    const secretHash = hashSecret(body.secret);
    const fetched = this.#db.prepare("SELECT * FROM remote_agent_bridge_invites WHERE secret_hash = ?").get(secretHash);
    const row = isInviteRow(fetched) ? fetched : undefined;
    if (!row || !sameHash(row.secret_hash, secretHash))
      return yield* fail(401, sourceText("error.team.authenticationRequired"));
    if (row.used_at) return yield* fail(409, sourceText("error.backend.remoteAgentBridgeInviteUsed"));
    if (Date.parse(row.expires_at) <= this.#now())
      return yield* fail(409, sourceText("error.backend.remoteAgentBridgeInviteExpired"));
    if (normalizeReach(body.peerReach) === normalizeReach(row.reach))
      return yield* fail(409, sourceText("error.backend.remoteAgentBridgeSameServer"));
    const outgoing = token();
    const link = this.#insertLink({
      peerName: body.peerName,
      peerReach: body.peerReach,
      incomingToken: body.peerToken,
      outgoingToken: outgoing,
    });
    this.#db
      .prepare("UPDATE remote_agent_bridge_invites SET used_at = ? WHERE invite_id = ?")
      .run(new Date(this.#now()).toISOString(), row.invite_id);
    return { token: outgoing, serverName: row.server_name, linkId: link.linkId };
  });

  revokeLink = Effect.fn("RemoteAgentBridge.revokeLink")(function* (
    this: RemoteAgentBridge,
    linkId: string,
  ): Effect.fn.Return<void, { cause: RemoteAgentBridgeError }> {
    const row = this.#linkById(linkId);
    this.#db.prepare("DELETE FROM remote_agent_bridge_links WHERE link_id = ?").run(linkId);
    if (!row) return;
    yield* this.#dial(
      {
        reach: row.peer_reach,
        token: this.#outgoingToken(row),
        method: "POST",
        path: REMOTE_AGENT_BRIDGE_ROUTES.peerRevoke,
        body: {},
      },
      decodeVoidResponse,
    ).pipe(Effect.catch(() => Effect.void));
  });

  revokeFromPeer(bearer: string | null): BridgeEffect<void> {
    const row = bearer ? this.#linkByToken(bearer) : undefined;
    if (!row) return fail(401, sourceText("error.backend.remoteAgentBridgeRevoked"));
    this.#db.prepare("DELETE FROM remote_agent_bridge_links WHERE link_id = ?").run(row.link_id);
    return Effect.void;
  }

  agentsForPeer(bearer: string | null): BridgeEffect<{ agents: { id: string; name: string }[] }> {
    if (!bearer || !this.#linkByToken(bearer)) return fail(401, sourceText("error.backend.remoteAgentBridgeRevoked"));
    return Effect.succeed({
      agents: this.#listLocalAgents().map((agent) => ({ id: agent.id, name: agent.name })),
    });
  }

  enqueueFromPeer = Effect.fn("RemoteAgentBridge.enqueueFromPeer")(function* (
    this: RemoteAgentBridge,
    bearer: string | null,
    message: RemoteAgentBridgeMessage,
  ): Effect.fn.Return<{ messageId: string }, { cause: RemoteAgentBridgeError }> {
    const row = bearer ? this.#linkByToken(bearer) : undefined;
    if (!row) return yield* fail(401, sourceText("error.backend.remoteAgentBridgeRevoked"));
    const known = this.#listLocalAgents().some((agent) => agent.id === message.recipientAgentId);
    if (!known) return yield* fail(404, sourceText("error.team.agentNotFound"));
    const files = yield* this.#filesFromWire(message.files ?? []);
    const paths = yield* this.#writeTemp(files);
    const receipt = yield* this.#enqueue({
      sender: {
        kind: "remote-agent",
        agentId: message.senderAgentId,
        agentName: message.senderAgentName,
        linkId: row.link_id,
        serverName: message.senderServerName,
      },
      recipientAgentIds: [message.recipientAgentId],
      text: message.text,
      replyToMessageId: message.replyToMessageId ?? null,
      sourcePaths: paths,
    }).pipe(
      Effect.mapError((failure) => ({ cause: new RemoteAgentBridgeError(500, String(failure.cause)) })),
      Effect.ensuring(
        Effect.promise(() => Promise.all(paths.map((path) => rm(path, { force: true }))).then(() => undefined)),
      ),
    );
    return { messageId: receipt.messageId };
  });

  listRemoteAgents = Effect.fn("RemoteAgentBridge.listRemoteAgents")(function* (
    this: RemoteAgentBridge,
  ): Effect.fn.Return<RemoteAgentBridgeAgent[], { cause: RemoteAgentBridgeError }> {
    const links = this.#openLinks();
    const counts = new Map<string, number>();
    for (const link of links) counts.set(link.peer_name, (counts.get(link.peer_name) ?? 0) + 1);
    const listed: RemoteAgentBridgeAgent[] = [];
    for (const link of links) {
      const page = yield* this.#dial(
        {
          reach: link.peer_reach,
          token: this.#outgoingToken(link),
          method: "POST",
          path: REMOTE_AGENT_BRIDGE_ROUTES.agents,
          body: {},
        },
        decodeAgentPage,
      ).pipe(Effect.catch(() => Effect.succeed({ agents: [] })));
      const suffix = (counts.get(link.peer_name) ?? 0) > 1 ? ` · ${link.link_id.slice(0, 4)}` : "";
      for (const agent of page.agents) {
        const id = remoteAgentId(link.link_id, agent.id);
        if (id.length > 128) continue;
        listed.push({ id, name: `${agent.name} (${link.peer_name}${suffix})` });
      }
    }
    return listed;
  });

  deliver = Effect.fn("RemoteAgentBridge.deliver")(function* (
    this: RemoteAgentBridge,
    input: {
      senderAgentId: string;
      senderAgentName: string;
      recipients: { linkId: string; agentId: string }[];
      text: string;
      paths: string[];
      replyToMessageId: string | null;
    },
  ): Effect.fn.Return<{ messageIds: string[] }, { cause: RemoteAgentBridgeError }> {
    const files = yield* this.#filesFromPaths(input.paths);
    const messageIds: string[] = [];
    for (const recipient of input.recipients) {
      const link = this.#linkById(recipient.linkId);
      if (!link) return yield* fail(404, sourceText("error.backend.remoteAgentBridgeRevoked"));
      const sent = yield* this.#dial(
        {
          reach: link.peer_reach,
          token: this.#outgoingToken(link),
          method: "POST",
          path: REMOTE_AGENT_BRIDGE_ROUTES.message,
          body: {
            senderAgentId: input.senderAgentId,
            senderAgentName: input.senderAgentName,
            senderServerName: this.#serverName(),
            recipientAgentId: recipient.agentId,
            text: input.text,
            ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
            files: files.map((file) => ({ name: file.name, data: file.data.toString("base64") })),
          },
        },
        decodeMessageReceipt,
      );
      messageIds.push(sent.messageId);
    }
    return { messageIds };
  });

  #insertLink(input: {
    peerName: string;
    peerReach: string;
    incomingToken: string;
    outgoingToken: string;
  }): RemoteAgentBridgeLink {
    const linkId = randomBytes(8).toString("hex");
    const createdAt = new Date(this.#now()).toISOString();
    this.#db
      .prepare(
        `INSERT INTO remote_agent_bridge_links
         (link_id, peer_name, peer_reach, peer_token_hash, token_ciphertext, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        linkId,
        input.peerName,
        normalizeReach(input.peerReach),
        hashSecret(input.incomingToken),
        this.#cipher.encrypt(input.outgoingToken),
        createdAt,
      );
    return { linkId, peerName: input.peerName, peerReach: normalizeReach(input.peerReach), createdAt };
  }

  #openLinks(): LinkRow[] {
    return readRows(
      this.#db.prepare("SELECT * FROM remote_agent_bridge_links WHERE revoked_at IS NULL").all(),
      isLinkRow,
    );
  }

  #linkById(linkId: string): LinkRow | undefined {
    const fetched = this.#db
      .prepare("SELECT * FROM remote_agent_bridge_links WHERE link_id = ? AND revoked_at IS NULL")
      .get(linkId);
    return isLinkRow(fetched) ? fetched : undefined;
  }

  #linkByToken(bearer: string): LinkRow | undefined {
    const hashed = hashSecret(bearer);
    const fetched = this.#db
      .prepare("SELECT * FROM remote_agent_bridge_links WHERE peer_token_hash = ? AND revoked_at IS NULL")
      .get(hashed);
    const row = isLinkRow(fetched) ? fetched : undefined;
    return row && sameHash(row.peer_token_hash, hashed) ? row : undefined;
  }

  #filesFromPaths(paths: string[]): BridgeEffect<BridgeFile[]> {
    return Effect.tryPromise({
      try: async () => {
        let total = 0;
        const files: BridgeFile[] = [];
        for (const path of paths) {
          const info = await stat(path);
          if (!info.isFile() || info.size > ATTACHMENT_LIMITS.fileBytes) {
            throw new RemoteAgentBridgeError(409, sourceText("error.backend.remoteAgentBridgeFileTooLarge"));
          }
          total += info.size;
          if (total > ATTACHMENT_LIMITS.totalBytes) {
            throw new RemoteAgentBridgeError(409, sourceText("error.backend.remoteAgentBridgeFileTooLarge"));
          }
          files.push({ name: basename(path), data: await readFile(path) });
        }
        return files;
      },
      catch: (cause) => ({
        cause:
          cause instanceof RemoteAgentBridgeError
            ? cause
            : new RemoteAgentBridgeError(409, sourceText("error.backend.remoteAgentBridgeFileTooLarge")),
      }),
    });
  }

  #filesFromWire(files: { name: string; data: string }[]): BridgeEffect<BridgeFile[]> {
    let total = 0;
    const decoded: BridgeFile[] = [];
    for (const file of files) {
      const data = Buffer.from(file.data, "base64");
      if (data.length > ATTACHMENT_LIMITS.fileBytes || file.name.includes("/") || file.name.includes("\\")) {
        return fail(409, sourceText("error.backend.remoteAgentBridgeFileTooLarge"));
      }
      total += data.length;
      if (total > ATTACHMENT_LIMITS.totalBytes)
        return fail(409, sourceText("error.backend.remoteAgentBridgeFileTooLarge"));
      decoded.push({ name: basename(file.name), data });
    }
    return Effect.succeed(decoded);
  }

  #writeTemp(files: BridgeFile[]): BridgeEffect<string[]> {
    return Effect.tryPromise({
      try: async () => {
        if (files.length === 0) return [];
        const directory = await mkdtemp(join(tmpdir(), "openbot-bridge-"));
        const paths: string[] = [];
        for (const file of files) {
          const path = join(directory, file.name);
          await writeFile(path, file.data);
          paths.push(path);
        }
        return paths;
      },
      catch: (cause) => ({ cause: new RemoteAgentBridgeError(500, String(cause)) }),
    });
  }

  #dial<A>(
    input: {
      reach: string;
      token: string | null;
      method: "POST";
      path: string;
      body: RemoteAgentBridgeDialBody;
    },
    decode: (value: unknown) => A,
  ): BridgeEffect<A> {
    const reach = normalizeReach(input.reach);
    let url: URL;
    try {
      url = new URL(input.path, reach.endsWith("/") ? reach : `${reach}/`);
    } catch {
      return fail(502, sourceText("error.backend.remoteAgentBridgePeerDown"));
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return fail(502, sourceText("error.backend.remoteAgentBridgePeerDown"));
    return Effect.tryPromise({
      try: async () => {
        const response = await fetch(url, {
          method: input.method,
          headers: {
            "content-type": "application/json",
            [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
            [TEAM_APP_VERSION_HEADER]: "openbot-host",
            ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
          },
          body: JSON.stringify(input.body),
          signal: AbortSignal.timeout(DIAL_TIMEOUT_MS),
        });
        const payload = await response.json().catch(() => null);
        if (response.status === 401) {
          if (input.token) this.#forgetToken(input.token);
          throw new RemoteAgentBridgeError(401, sourceText("error.backend.remoteAgentBridgeRevoked"));
        }
        if (!response.ok) {
          const message =
            isDynamicRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : sourceText("error.backend.remoteAgentBridgePeerDown");
          throw new RemoteAgentBridgeError(response.status, message);
        }
        return decode(payload);
      },
      catch: (cause) => ({
        cause:
          cause instanceof RemoteAgentBridgeError
            ? cause
            : new RemoteAgentBridgeError(502, sourceText("error.backend.remoteAgentBridgePeerDown")),
      }),
    });
  }

  #outgoingToken(link: LinkRow): string {
    return this.#cipher.decrypt(Buffer.from(link.token_ciphertext));
  }

  #forgetToken(outgoing: string): void {
    const hashed = hashSecret(outgoing);
    for (const link of this.#openLinks()) {
      if (this.#outgoingToken(link) === outgoing || sameHash(link.peer_token_hash, hashed)) {
        this.#db.prepare("DELETE FROM remote_agent_bridge_links WHERE link_id = ?").run(link.link_id);
      }
    }
  }
}
