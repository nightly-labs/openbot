import { randomUUID } from "node:crypto";
import { MESSAGING_PLATFORMS, type MessagingPlatform } from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { deleteAggregateHistory, deleteThreadAttachments } from "../database/database-core";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import { withTransaction } from "../database/sqlite-transaction";
import { cachedStatement } from "../database/statement-cache";
import type { OpenBotDatabase } from "../openbot-database";

export interface MessagingConnectionRecord {
  connectionId: string;
  platform: MessagingPlatform;
  workspaceId: string;
  workspaceName: string;
  enabled: boolean;
  botUserId: string | null;
  appId: string | null;
  orchestratorAgentId: string | null;
  lastErrorCode: string | null;
}

export interface MessagingLink {
  linkId: string;
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  threadKey: string;
  isDirect: boolean;
  threadId: string;
  title: string;
  historyCursor: string | null;
  updatedAt: string;
}

export interface MessagingAllowedRole {
  id: string;
  name: string;
}

export interface MessagingAllowedSender {
  id: string;
  kind: "contact" | "group";
  name: string;
}

export interface MessagingPingInput {
  connectionId: string;
  platformChannelId: string;
  threadKey: string;
  userIds: readonly string[];
  agentId: string;
  text: string;
}

export interface MessagingPing {
  userId: string;
  agentId: string;
  text: string;
  createdAt: string;
}

export interface MessagingLinkInput {
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  threadKey: string;
  isDirect: boolean;
  title: string;
}

const LINK_LIST_LIMIT = 200;

export class MessagingStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  connections(): MessagingConnectionRecord[] {
    return databaseRows(
      this.#database.connection.prepare("SELECT * FROM projection_messaging_connections ORDER BY created_at").all(),
    ).flatMap(decodeConnection);
  }

  connectionForWorkspace(platform: MessagingPlatform, workspaceId: string): MessagingConnectionRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM projection_messaging_connections WHERE platform = ? AND workspace_id = ?")
        .get(platform, workspaceId),
    );
    return row ? (decodeConnection(row)[0] ?? null) : null;
  }

  connection(connectionId: string): MessagingConnectionRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM projection_messaging_connections WHERE connection_id = ?")
        .get(connectionId),
    );
    return row ? (decodeConnection(row)[0] ?? null) : null;
  }

  ensureConnection(platform: MessagingPlatform, workspaceId: string, workspaceName: string): MessagingConnectionRecord {
    const existing = this.connectionForWorkspace(platform, workspaceId);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO projection_messaging_connections
           (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(`messaging-${randomUUID()}`, platform, workspaceId, workspaceName, now, now);
    const created = this.connectionForWorkspace(platform, workspaceId);
    if (!created) throw new Error("The messaging connection was not stored.");
    return created;
  }

  updateConnection(
    connectionId: string,
    changes: Partial<Omit<MessagingConnectionRecord, "connectionId" | "platform" | "workspaceId">>,
  ): void {
    const current = this.connection(connectionId);
    if (!current) return;
    const next = { ...current, ...changes };
    this.#database.connection
      .prepare(
        `UPDATE projection_messaging_connections
         SET enabled = ?, workspace_name = ?, bot_user_id = ?, app_id = ?, orchestrator_agent_id = ?,
             last_error_code = ?, updated_at = ?
         WHERE connection_id = ?`,
      )
      .run(
        next.enabled ? 1 : 0,
        next.workspaceName,
        next.botUserId,
        next.appId,
        next.orchestratorAgentId,
        next.lastErrorCode,
        new Date().toISOString(),
        connectionId,
      );
  }

  allowedRoles(connectionId: string): MessagingAllowedRole[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT role_id, role_name FROM projection_messaging_allowed_roles
           WHERE connection_id = ? ORDER BY created_at, role_name, role_id`,
        )
        .all(connectionId),
    ).map((row) => ({ id: requiredStringColumn(row, "role_id"), name: requiredStringColumn(row, "role_name") }));
  }

  replaceAllowedRoles(connectionId: string, roles: readonly MessagingAllowedRole[]): void {
    const db = this.#database.connection;
    withTransaction(db, () => {
      const kept = new Set(roles.map((role) => role.id));
      for (const current of this.allowedRoles(connectionId))
        if (!kept.has(current.id))
          db.prepare("DELETE FROM projection_messaging_allowed_roles WHERE connection_id = ? AND role_id = ?").run(
            connectionId,
            current.id,
          );
      const now = new Date().toISOString();
      const upsert = db.prepare(
        `INSERT INTO projection_messaging_allowed_roles (connection_id, role_id, role_name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(connection_id, role_id) DO UPDATE SET role_name = excluded.role_name`,
      );
      for (const role of roles) upsert.run(connectionId, role.id, role.name, now);
    });
  }

  allowedSenders(connectionId: string): MessagingAllowedSender[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT sender_id, kind, name FROM projection_messaging_allowed_senders
           WHERE connection_id = ? ORDER BY created_at, name, sender_id`,
        )
        .all(connectionId),
    ).flatMap((row) => {
      const kind = requiredStringColumn(row, "kind");
      if (kind !== "contact" && kind !== "group") return [];
      return [{ id: requiredStringColumn(row, "sender_id"), kind, name: requiredStringColumn(row, "name") }];
    });
  }

  addAllowedSender(connectionId: string, sender: MessagingAllowedSender): void {
    this.#database.connection
      .prepare(
        `INSERT INTO projection_messaging_allowed_senders (connection_id, sender_id, kind, name, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, sender_id) DO UPDATE SET name = excluded.name`,
      )
      .run(connectionId, sender.id, sender.kind, sender.name, new Date().toISOString());
  }

  removeAllowedSender(connectionId: string, senderId: string): void {
    this.#database.connection
      .prepare("DELETE FROM projection_messaging_allowed_senders WHERE connection_id = ? AND sender_id = ?")
      .run(connectionId, senderId);
  }

  savePings(input: MessagingPingInput): void {
    const db = this.#database.connection;
    withTransaction(db, () => {
      const upsert = db.prepare(
        `INSERT INTO projection_messaging_pings
           (connection_id, platform_channel_id, thread_key, user_id, agent_id, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, platform_channel_id, thread_key, user_id)
         DO UPDATE SET agent_id = excluded.agent_id, text = excluded.text, created_at = excluded.created_at`,
      );
      const now = new Date().toISOString();
      for (const userId of input.userIds)
        upsert.run(
          input.connectionId,
          input.platformChannelId,
          input.threadKey,
          userId,
          input.agentId,
          input.text,
          now,
        );
    });
  }

  pings(connectionId: string, platformChannelId: string, threadKey: string): MessagingPing[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT user_id, agent_id, text, created_at FROM projection_messaging_pings
           WHERE connection_id = ? AND platform_channel_id = ? AND thread_key = ?`,
        )
        .all(connectionId, platformChannelId, threadKey),
    ).map((row) => ({
      userId: requiredStringColumn(row, "user_id"),
      agentId: requiredStringColumn(row, "agent_id"),
      text: requiredStringColumn(row, "text"),
      createdAt: requiredStringColumn(row, "created_at"),
    }));
  }

  link(linkId: string): MessagingLink | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM projection_messaging_threads WHERE link_id = ?").get(linkId),
    );
    return row ? decodeLink(row) : null;
  }

  linkByKey(connectionId: string, platformChannelId: string, threadKey: string): MessagingLink | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT * FROM projection_messaging_threads
           WHERE connection_id = ? AND platform_channel_id = ? AND thread_key = ?`,
        )
        .get(connectionId, platformChannelId, threadKey),
    );
    return row ? decodeLink(row) : null;
  }

  linkForThread(threadId: string): MessagingLink | null {
    const row = databaseRow(
      cachedStatement(this.#database.connection, "SELECT * FROM projection_messaging_threads WHERE thread_id = ?").get(
        threadId,
      ),
    );
    return row ? decodeLink(row) : null;
  }

  links(agentId: string): MessagingLink[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          "SELECT * FROM projection_messaging_threads WHERE agent_id = ? ORDER BY updated_at DESC, link_id LIMIT ?",
        )
        .all(agentId, LINK_LIST_LIMIT),
    ).map(decodeLink);
  }

  executionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.#database.connection.prepare("SELECT agent_id, thread_id FROM projection_messaging_threads").all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  ensureLink(input: MessagingLinkInput): MessagingLink {
    const existing = this.linkByKey(input.connectionId, input.platformChannelId, input.threadKey);
    if (existing) return existing;
    const linkId = `messaging-link-${randomUUID()}`;
    const threadId = `openbot-thread-${randomUUID()}`;
    this.#database.dispatch(
      `messaging-thread:${linkId}`,
      [
        {
          aggregateType: "messaging-thread",
          aggregateId: linkId,
          eventType: "messaging.thread-created",
          payload: { agentId: input.agentId, threadId },
        },
      ],
      (db, sequences) => {
        const now = new Date().toISOString();
        db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
          threadId,
          input.agentId,
          input.title,
          now,
          now,
          sequences[0] ?? 0,
        );
        db.prepare(
          `INSERT INTO projection_messaging_threads
             (link_id, connection_id, agent_id, platform_channel_id, thread_key, is_direct, thread_id, title,
              history_cursor, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(
          linkId,
          input.connectionId,
          input.agentId,
          input.platformChannelId,
          input.threadKey,
          input.isDirect ? 1 : 0,
          threadId,
          input.title,
          now,
          now,
        );
        return null;
      },
    );
    const created = this.link(linkId);
    if (!created) throw new Error("The messaging thread was not stored.");
    return created;
  }

  touch(linkId: string, historyCursor?: string): void {
    const now = new Date().toISOString();
    if (historyCursor === undefined)
      this.#database.connection
        .prepare("UPDATE projection_messaging_threads SET updated_at = ? WHERE link_id = ?")
        .run(now, linkId);
    else
      this.#database.connection
        .prepare("UPDATE projection_messaging_threads SET updated_at = ?, history_cursor = ? WHERE link_id = ?")
        .run(now, historyCursor, linkId);
  }

  deleteForAgent(agentId: string): void {
    const links = databaseRows(
      this.#database.connection
        .prepare("SELECT link_id, thread_id FROM projection_messaging_threads WHERE agent_id = ?")
        .all(agentId),
    ).map((row) => ({
      linkId: requiredStringColumn(row, "link_id"),
      threadId: requiredStringColumn(row, "thread_id"),
    }));
    this.#database.dispatch(
      `messaging-agent-deleted:${agentId}:${randomUUID()}`,
      [
        {
          aggregateType: "messaging-agent",
          aggregateId: agentId,
          eventType: "messaging.agent-deleted",
          payload: { threadIds: links.map((link) => link.threadId) },
        },
      ],
      (db) => {
        deleteAggregateHistory(
          db,
          "messaging-thread",
          links.map((link) => link.linkId),
        );
        for (const { threadId } of links) {
          deleteAggregateHistory(db, "thread", [threadId]);
          deleteThreadAttachments(db, threadId);
        }
        db.prepare(
          `DELETE FROM projection_messaging_pings WHERE EXISTS (
             SELECT 1 FROM projection_messaging_threads AS link WHERE link.agent_id = ?
               AND link.connection_id = projection_messaging_pings.connection_id
               AND link.platform_channel_id = projection_messaging_pings.platform_channel_id
               AND link.thread_key = projection_messaging_pings.thread_key)`,
        ).run(agentId);
        db.prepare(
          `DELETE FROM projection_messaging_pings WHERE agent_id = ? AND NOT EXISTS (
             SELECT 1 FROM projection_messaging_threads AS link
             WHERE link.connection_id = projection_messaging_pings.connection_id
               AND link.platform_channel_id = projection_messaging_pings.platform_channel_id
               AND link.thread_key = projection_messaging_pings.thread_key)`,
        ).run(agentId);
        db.prepare("DELETE FROM projection_messaging_threads WHERE agent_id = ?").run(agentId);
        for (const { threadId } of links)
          db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
        db.prepare(
          "UPDATE projection_messaging_connections SET orchestrator_agent_id = NULL WHERE orchestrator_agent_id = ?",
        ).run(agentId);
        return null;
      },
    );
  }

  threadIdsForAgent(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT thread_id FROM projection_messaging_threads WHERE agent_id = ?")
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }
}

function decodeConnection(row: DynamicRecord): MessagingConnectionRecord[] {
  const platform = requiredStringColumn(row, "platform");
  if (!isOneOf(MESSAGING_PLATFORMS, platform)) return [];
  return [
    {
      connectionId: requiredStringColumn(row, "connection_id"),
      platform,
      workspaceId: requiredStringColumn(row, "workspace_id"),
      workspaceName: requiredStringColumn(row, "workspace_name"),
      enabled: requiredNumberColumn(row, "enabled") === 1,
      botUserId: optionalStringColumn(row, "bot_user_id"),
      appId: optionalStringColumn(row, "app_id"),
      orchestratorAgentId: optionalStringColumn(row, "orchestrator_agent_id"),
      lastErrorCode: optionalStringColumn(row, "last_error_code"),
    },
  ];
}

function decodeLink(row: DynamicRecord): MessagingLink {
  return {
    linkId: requiredStringColumn(row, "link_id"),
    connectionId: requiredStringColumn(row, "connection_id"),
    agentId: requiredStringColumn(row, "agent_id"),
    platformChannelId: requiredStringColumn(row, "platform_channel_id"),
    threadKey: requiredStringColumn(row, "thread_key"),
    isDirect: requiredNumberColumn(row, "is_direct") === 1,
    threadId: requiredStringColumn(row, "thread_id"),
    title: requiredStringColumn(row, "title"),
    historyCursor: optionalStringColumn(row, "history_cursor"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}
