import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CHANNEL_CHATS_CAPABILITY,
  type ChannelMessage,
  type ChannelPage,
  type ConversationMessage,
  type ConversationPage,
  type ConversationPageAnchor,
  canAdministerServer,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { TEAM_HISTORY_EXTENT_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { SETTING_LINK_MARKERS_CAPABILITY } from "@openbot/contracts/team-protocol/setting-link-markers-v1";
import { SYNC_SNAPSHOT_KEY, type SyncLogSpec } from "@openbot/contracts/team-protocol/sync-collections";
import {
  AGENT_MESSAGES_SYNC_LOG,
  CHANNEL_MESSAGES_SYNC_LOG,
  CHANNEL_PAGE_META_SYNC_COLLECTION,
  CONVERSATION_PAGE_META_SYNC_COLLECTION,
  type ConversationPageMeta,
} from "@openbot/contracts/team-protocol/sync-logs";
import { SYNC_LIMITS, type SyncLogReference, type SyncLogRow } from "@openbot/contracts/team-protocol/sync-v1";
import type { ChannelService } from "../../backend/channel-service";
import { conversationMarkerSqlFilter } from "../../backend/database/conversation-queries";
import {
  databaseRow,
  databaseRows,
  decodeConversationMessageJson,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../../backend/database/database-rows";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { OpenBotDatabase } from "../../backend/openbot-database";
import type { TeamApiAgents } from "./dependencies";
import { markerExclusionsForCapabilities, messageTextCut } from "./request-helpers";
import { channelReadPage, channelVisible, peerChannel, shownChannelMessage } from "./route-channels";
import { type TeamSyncViewer, teamSyncViewerKey } from "./sync-collections";
import type { SyncEntries, SyncHostCollection, SyncHostLog, SyncLogDiff, SyncLogPage, SyncLogWindow } from "./sync-hub";

type TeamSyncChannels = Pick<ChannelService, "store" | "taskWaits">;

export interface TeamSyncLogSources {
  agents(): Pick<TeamApiAgents, "listAgents" | "listQueue" | "readConversationPageFor">;
  channels(): TeamSyncChannels | undefined;
  database(): Pick<OpenBotDatabase, "connection"> | undefined;
  response(viewer: TeamSyncViewer, method: string, path: string, value: TeamSyncLogBody): unknown;
}

type ChangeScope = "thread" | "channel";

interface ChangeRange {
  readonly after: number;
  readonly through: number;
}

interface ThreadRowOrder {
  readonly order: string;
  readonly createdAt: string;
  readonly ordinal: number;
}

const MAX_SYNC_LOG_CHANGES = 1_000;
const CHANNEL_PAGE_LIMIT = 100;
const ORDER_NUMBER_BIAS = 2 ** 52;
const ORDER_NUMBER_WIDTH = 11;
const ORDER_TIME_WIDTH = 24;
const ORDER_GROUP_WIDTH = 40;
const QUEUE_MARK_WIDTH = 8;
const ROW_BODY_BUDGET = Math.floor(SYNC_LIMITS.rowBytes * 0.75);
const THREAD_ORDER_COLUMNS = "group_start, group_first, group_id, turn_rank, created_at, ordinal";

export type TeamSyncLogBody = ConversationPage | ChannelPage;

export function teamSyncLogs(sources: TeamSyncLogSources): SyncHostLog<TeamSyncViewer>[] {
  return [agentMessagesLog(sources), channelMessagesLog(sources)];
}

export function teamSyncPageMetas(sources: TeamSyncLogSources): SyncHostCollection<TeamSyncViewer>[] {
  return [conversationPageMeta(sources), channelPageMeta(sources)];
}

function readConversationPage(
  sources: TeamSyncLogSources,
  viewer: TeamSyncViewer,
  agentId: string,
  anchor: ConversationPageAnchor,
  limit: number,
): Promise<ConversationPage> {
  return runCauseEffect(
    sources
      .agents()
      .readConversationPageFor(
        agentId,
        viewer.member.id,
        anchor,
        limit,
        markerExclusionsForCapabilities(viewer.capabilities),
      ),
  );
}

function conversationPageMeta(sources: TeamSyncLogSources): SyncHostCollection<TeamSyncViewer> {
  return {
    name: CONVERSATION_PAGE_META_SYNC_COLLECTION.name,
    scoped: true,
    async read(viewer, agentId): Promise<SyncEntries | null> {
      if (agentId === null || !readableAgent(sources, viewer, agentId)) return null;
      const page = await readConversationPage(sources, viewer, agentId, { type: "latest" }, 1);
      const body = sources.response(viewer, "GET", TEAM_API_ROUTES.agent.conversationPage(agentId), {
        ...page,
        messages: [],
        references: {},
      });
      if (!isDynamicRecord(body)) throw new Error("Team sync conversation page is not a record.");
      const meta = {
        agentId,
        threadId: body.threadId,
        activeTurnId: body.activeTurnId,
        revision: body.revision,
        messageCount: (page.pageInfo.olderCount ?? 0) + page.messages.length,
        oldestAt: page.pageInfo.oldestAt ?? null,
        historyExtent: viewer.capabilities.has(TEAM_HISTORY_EXTENT_CAPABILITY),
        ...(body.readState === undefined ? {} : { readState: body.readState }),
      };
      const decoded: ConversationPageMeta = CONVERSATION_PAGE_META_SYNC_COLLECTION.decode(meta);
      return [[SYNC_SNAPSHOT_KEY, decoded]];
    },
  };
}

function channelPageMeta(sources: TeamSyncLogSources): SyncHostCollection<TeamSyncViewer> {
  return {
    name: CHANNEL_PAGE_META_SYNC_COLLECTION.name,
    scoped: true,
    read(viewer, channelId): SyncEntries | null {
      const channels = channelId === null ? null : readableChannels(sources, viewer, channelId);
      if (channelId === null || !channels) return null;
      const page = channelReadPage(channels, channelId, undefined, {
        capabilities: viewer.capabilities,
        hiddenAgentIds: viewer.hiddenAgentIds,
        channelHiddenAgentIds: channelHiddenAgentIds(viewer),
      });
      const body = sources.response(viewer, "POST", CHANNEL_ROUTES.read, page);
      if (!isDynamicRecord(body)) throw new Error("Team sync channel page is not a record.");
      const { messages: _messages, ...meta } = body;
      CHANNEL_PAGE_META_SYNC_COLLECTION.decode(meta);
      return [[SYNC_SNAPSHOT_KEY, meta]];
    },
  };
}

function agentMessagesLog(sources: TeamSyncLogSources): SyncHostLog<TeamSyncViewer> {
  const readPage = (viewer: TeamSyncViewer, agentId: string, anchor: ConversationPageAnchor, limit: number) =>
    readConversationPage(sources, viewer, agentId, anchor, limit);
  const pageRows = (viewer: TeamSyncViewer, connection: DatabaseSync, page: ConversationPage): SyncLogPage => {
    const orders = threadRowOrders(
      connection,
      page.threadId,
      page.messages.map((message) => message.id),
    );
    const first = page.messages[0];
    const firstOrder = first ? orders.get(first.id) : undefined;
    const httpCursor = page.pageInfo.olderCursor;
    return {
      ...agentRows(sources, viewer, page, orders),
      olderCursor:
        httpCursor === null || !first || !firstOrder
          ? null
          : httpCursor.length <= SYNC_LIMITS.cursor
            ? httpCursor
            : olderConversationCursor(first.id, firstOrder),
    };
  };
  return {
    name: AGENT_MESSAGES_SYNC_LOG.name,
    async latest(viewer, agentId, limit): Promise<SyncLogWindow | null> {
      const database = sources.database();
      if (!database || !readableAgent(sources, viewer, agentId)) return null;
      const through = lastChange(database.connection);
      const page = await readPage(viewer, agentId, { type: "latest" }, limit);
      return {
        ...pageRows(viewer, database.connection, page),
        cursor: queueCursor(
          changeCursor(through, cursorTag(viewer, "thread", page.threadId)),
          queueMark(queuedPositions(sources, agentId)),
        ),
      };
    },
    async older(viewer, agentId, before, limit): Promise<SyncLogPage | null> {
      const database = sources.database();
      if (!database || !readableAgent(sources, viewer, agentId)) return null;
      const page = await readPage(viewer, agentId, { type: "before", cursor: before }, limit);
      return pageRows(viewer, database.connection, page);
    },
    async since(viewer, agentId, cursor): Promise<SyncLogDiff | "reset" | null> {
      const database = sources.database();
      if (!database || !readableAgent(sources, viewer, agentId)) return null;
      const skeleton = await readPage(viewer, agentId, { type: "latest" }, 1);
      const tag = cursorTag(viewer, "thread", skeleton.threadId);
      const threadId = skeleton.threadId ?? "";
      const sent = cursorQueueMark(cursor);
      const range = changeRange(database.connection, "thread", threadId, sent.cursor, tag);
      if (range === "reset") return "reset";
      const positions = queuedPositions(sources, agentId);
      const mark = queueMark(positions);
      const filter = conversationMarkerSqlFilter(markerExclusionsForCapabilities(viewer.capabilities));
      const changes = databaseRows(
        database.connection
          .prepare(
            `SELECT c.message_id AS changed_id, m.message_json, ${prefixed("m", THREAD_ORDER_COLUMNS)}
             FROM sync_message_changes c
             LEFT JOIN projection_thread_messages m
               ON m.thread_id = c.owner_id AND m.message_id = c.message_id ${filter}
             WHERE c.scope = 'thread' AND c.owner_id = ? AND c.sequence > ? AND c.sequence <= ?
             ORDER BY c.sequence`,
          )
          .all(threadId, range.after, range.through),
      );
      const changedIds = new Set(changes.map((change) => requiredStringColumn(change, "changed_id")));
      const requeued =
        sent.mark === mark
          ? []
          : queuedRows(
              database.connection,
              threadId,
              [...positions.keys()].filter((id) => !changedIds.has(id)),
              filter,
            );
      const messages: ConversationMessage[] = [];
      const orders = new Map<string, ThreadRowOrder>();
      for (const change of [...changes, ...requeued]) {
        const json = optionalStringColumn(change, "message_json");
        if (json === null) continue;
        const message = withQueuePosition(decodeConversationMessageJson(json), positions);
        messages.push(message);
        orders.set(message.id, threadRowOrder(change));
      }
      const { rows, references } = agentRows(
        sources,
        viewer,
        {
          ...skeleton,
          messages,
          references: replyTargets(database.connection, threadId, messages, filter),
          pageInfo: { hasOlder: false, olderCursor: null },
        },
        orders,
      );
      return {
        rows,
        references,
        deletes: removedKeys(
          changes.map((change) => requiredStringColumn(change, "changed_id")),
          rows,
        ),
        cursor: queueCursor(changeCursor(range.through, tag), mark),
      };
    },
  };
}

function queuedPositions(sources: TeamSyncLogSources, agentId: string): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  for (const delivery of sources.agents().listQueue(agentId).deliveries)
    if (delivery.status === "queued" && delivery.position !== null) positions.set(delivery.id, delivery.position);
  return positions;
}

function queueMark(positions: ReadonlyMap<string, number>): string {
  return createHash("sha256")
    .update([...positions].map(([id, position]) => `${id}:${position}`).join("\n"))
    .digest("hex")
    .slice(0, QUEUE_MARK_WIDTH);
}

function queueCursor(cursor: string, mark: string): string {
  return `${cursor}.${mark}`;
}

function cursorQueueMark(cursor: string): { cursor: string; mark: string | null } {
  const match = new RegExp(`^(.+)\\.([0-9a-f]{${QUEUE_MARK_WIDTH}})$`, "u").exec(cursor);
  return match?.[1] && match[2] ? { cursor: match[1], mark: match[2] } : { cursor, mark: null };
}

function withQueuePosition(message: ConversationMessage, positions: ReadonlyMap<string, number>): ConversationMessage {
  const delivery = message.delivery;
  const position = delivery?.status === "queued" ? positions.get(delivery.id) : undefined;
  return delivery && position !== undefined ? { ...message, delivery: { ...delivery, position } } : message;
}

function queuedRows(
  connection: DatabaseSync,
  threadId: string,
  messageIds: readonly string[],
  filter: string,
): DynamicRecord[] {
  if (messageIds.length === 0) return [];
  return databaseRows(
    connection
      .prepare(
        `SELECT message_id AS changed_id, message_json, ${THREAD_ORDER_COLUMNS} FROM projection_thread_messages
         WHERE thread_id = ? AND message_id IN (${messageIds.map(() => "?").join(", ")}) ${filter}`,
      )
      .all(threadId, ...messageIds),
  );
}

function channelMessagesLog(sources: TeamSyncLogSources): SyncHostLog<TeamSyncViewer> {
  const pageRows = (
    viewer: TeamSyncViewer,
    channels: Pick<ChannelService, "store">,
    channelId: string,
    before: number | undefined,
    limit: number,
  ): SyncLogPage => {
    const page = channels.store.pageWithoutExtent(channelId, before, Math.min(limit, CHANNEL_PAGE_LIMIT));
    const messages = page.messages.filter((item) =>
      shownChannelMessage(item, viewer.hiddenAgentIds, settingLinks(viewer)),
    );
    return {
      rows: channelRows(sources, viewer, { ...page, channel: peerChannel(page.channel), messages }),
      olderCursor: page.olderCursor === null ? null : String(page.olderCursor),
    };
  };
  return {
    name: CHANNEL_MESSAGES_SYNC_LOG.name,
    latest(viewer, channelId, limit): SyncLogWindow | null {
      const database = sources.database();
      const channels = readableChannels(sources, viewer, channelId);
      if (!database || !channels) return null;
      const through = lastChange(database.connection);
      return {
        ...pageRows(viewer, channels, channelId, undefined, limit),
        cursor: changeCursor(through, cursorTag(viewer, "channel", channelId)),
      };
    },
    older(viewer, channelId, before, limit): SyncLogPage | null {
      const channels = readableChannels(sources, viewer, channelId);
      const sequence = /^\d{1,15}$/u.test(before) ? Number(before) : null;
      if (!channels || sequence === null) return null;
      return pageRows(viewer, channels, channelId, sequence, limit);
    },
    since(viewer, channelId, cursor): SyncLogDiff | "reset" | null {
      const database = sources.database();
      const channels = readableChannels(sources, viewer, channelId);
      if (!database || !channels) return null;
      const tag = cursorTag(viewer, "channel", channelId);
      const range = changeRange(database.connection, "channel", channelId, cursor, tag);
      if (range === "reset") return "reset";
      const changed = databaseRows(
        database.connection
          .prepare(
            `SELECT message_id FROM sync_message_changes
             WHERE scope = 'channel' AND owner_id = ? AND sequence > ? AND sequence <= ?
             ORDER BY sequence`,
          )
          .all(channelId, range.after, range.through),
      ).map((row) => requiredStringColumn(row, "message_id"));
      const messages = changed
        .map((messageId) => channels.store.message(channelId, messageId))
        .filter(
          (item): item is ChannelMessage =>
            item !== null && shownChannelMessage(item, viewer.hiddenAgentIds, settingLinks(viewer)),
        );
      const skeleton = channels.store.pageWithoutExtent(channelId, undefined, 1);
      const rows = channelRows(sources, viewer, {
        ...skeleton,
        olderCursor: null,
        channel: peerChannel(skeleton.channel),
        messages,
      });
      return { rows, deletes: removedKeys(changed, rows), cursor: changeCursor(range.through, tag) };
    },
  };
}

function readableAgent(sources: TeamSyncLogSources, viewer: TeamSyncViewer, agentId: string): boolean {
  return (
    !viewer.hiddenAgentIds.has(agentId) &&
    sources
      .agents()
      .listAgents()
      .some((agent) => agent.id === agentId)
  );
}

function readableChannels(
  sources: TeamSyncLogSources,
  viewer: TeamSyncViewer,
  channelId: string,
): TeamSyncChannels | null {
  const channels = sources.channels();
  if (!channels || !viewer.capabilities.has(CHANNEL_CHATS_CAPABILITY) || !channels.store.exists(channelId)) return null;
  return channelVisible(channels, channelId, channelHiddenAgentIds(viewer)) ? channels : null;
}

function channelHiddenAgentIds(viewer: TeamSyncViewer): ReadonlySet<string> {
  return canAdministerServer(viewer.member.role) ? new Set() : viewer.hiddenAgentIds;
}

function replyTargets(
  connection: DatabaseSync,
  threadId: string,
  messages: readonly ConversationMessage[],
  filter: string,
): Record<string, ConversationMessage> {
  const shown = new Set(messages.map((message) => message.id));
  const targets = [
    ...new Set(
      messages.flatMap((message) =>
        message.replyToMessageId && !shown.has(message.replyToMessageId) ? [message.replyToMessageId] : [],
      ),
    ),
  ];
  if (targets.length === 0) return {};
  const rows = databaseRows(
    connection
      .prepare(
        `SELECT message_id, message_json FROM projection_thread_messages
         WHERE thread_id = ? AND message_id IN (${targets.map(() => "?").join(", ")})
         ${filter}`,
      )
      .all(threadId, ...targets),
  );
  return Object.fromEntries(
    rows.map((row) => [
      requiredStringColumn(row, "message_id"),
      decodeConversationMessageJson(requiredStringColumn(row, "message_json")),
    ]),
  );
}

function settingLinks(viewer: TeamSyncViewer): boolean {
  return viewer.capabilities.has(SETTING_LINK_MARKERS_CAPABILITY);
}

function agentRows(
  sources: TeamSyncLogSources,
  viewer: TeamSyncViewer,
  page: ConversationPage,
  orders: ReadonlyMap<string, ThreadRowOrder>,
): { rows: SyncLogRow[]; references: SyncLogReference[] } {
  const body = sources.response(viewer, "GET", TEAM_API_ROUTES.agent.conversationPage(page.agentId), {
    ...page,
    messages: page.messages.map(fittedMessage),
    references: Object.fromEntries(Object.entries(page.references).map(([id, item]) => [id, fittedMessage(item)])),
  });
  const rows = encodedRows(AGENT_MESSAGES_SYNC_LOG, body, (message) => {
    const order = orders.get(message.id);
    if (!order) throw new Error("Team sync log message has no order.");
    return order.order;
  });
  return { rows, references: encodedReferences(AGENT_MESSAGES_SYNC_LOG, body) };
}

function fittedMessage(message: ConversationMessage): ConversationMessage {
  const bytes = Buffer.byteLength(JSON.stringify(message));
  return bytes <= ROW_BODY_BUDGET ? message : messageTextCut([message], bytes - ROW_BODY_BUDGET)(message);
}

function encodedReferences<Entity>(spec: SyncLogSpec<Entity>, body: unknown): SyncLogReference[] {
  if (!isDynamicRecord(body) || !isDynamicRecord(body.references))
    throw new Error("Team sync log page has no references.");
  return Object.entries(body.references).map(([key, value]) => {
    if (spec.key(spec.decode(value)) !== key) throw new Error("Team sync log reference has a different key.");
    return { key, value };
  });
}

function channelRows(sources: TeamSyncLogSources, viewer: TeamSyncViewer, page: ChannelPage): SyncLogRow[] {
  const body = sources.response(viewer, "POST", CHANNEL_ROUTES.read, {
    ...page,
    messages: page.messages.map((item) => ({ ...item, message: fittedMessage(item.message) })),
  });
  return encodedRows(CHANNEL_MESSAGES_SYNC_LOG, body, (message) => orderNumber(message.sequence));
}

function encodedRows<Entity>(
  spec: SyncLogSpec<Entity>,
  body: unknown,
  order: (entity: Entity) => string,
): SyncLogRow[] {
  if (!isDynamicRecord(body) || !Array.isArray(body.messages)) throw new Error("Team sync log page has no messages.");
  return body.messages.map((value: unknown) => {
    const entity = spec.decode(value);
    return { key: spec.key(entity), order: order(entity), value };
  });
}

function removedKeys(changed: readonly string[], rows: readonly SyncLogRow[]): string[] {
  const shown = new Set(rows.map((row) => row.key));
  return [...new Set(changed.filter((key) => !shown.has(key)))];
}

function threadRowOrders(
  connection: DatabaseSync,
  threadId: string | null,
  messageIds: readonly string[],
): Map<string, ThreadRowOrder> {
  if (!threadId || messageIds.length === 0) return new Map();
  const rows = databaseRows(
    connection
      .prepare(
        `SELECT message_id, ${THREAD_ORDER_COLUMNS} FROM projection_thread_messages
         WHERE thread_id = ? AND message_id IN (${messageIds.map(() => "?").join(", ")})`,
      )
      .all(threadId, ...messageIds),
  );
  return new Map(rows.map((row) => [requiredStringColumn(row, "message_id"), threadRowOrder(row)]));
}

function threadRowOrder(row: DynamicRecord): ThreadRowOrder {
  const createdAt = requiredStringColumn(row, "created_at");
  const ordinal = requiredNumberColumn(row, "ordinal");
  return {
    order: [
      orderText(requiredStringColumn(row, "group_start"), ORDER_TIME_WIDTH),
      orderNumber(requiredNumberColumn(row, "group_first")),
      orderText(requiredStringColumn(row, "group_id"), ORDER_GROUP_WIDTH),
      orderNumber(requiredNumberColumn(row, "turn_rank")),
      orderText(createdAt, ORDER_TIME_WIDTH),
      orderNumber(ordinal),
    ].join(""),
    createdAt,
    ordinal,
  };
}

function olderConversationCursor(messageId: string, order: ThreadRowOrder): string {
  return Buffer.from(
    JSON.stringify({ version: 1, createdAt: order.createdAt, ordinal: order.ordinal, messageId }),
    "utf8",
  ).toString("base64url");
}

function orderText(value: string, width: number): string {
  return value.slice(0, width).padEnd(width, " ");
}

function orderNumber(value: number): string {
  if (!Number.isSafeInteger(value) || Math.abs(value) >= ORDER_NUMBER_BIAS)
    throw new Error("Team sync log order number is out of range.");
  return (value + ORDER_NUMBER_BIAS).toString(36).padStart(ORDER_NUMBER_WIDTH, "0");
}

function prefixed(table: string, columns: string): string {
  return columns
    .split(", ")
    .map((column) => `${table}.${column}`)
    .join(", ");
}

function cursorTag(viewer: TeamSyncViewer, scope: ChangeScope, ownerId: string | null): string {
  return createHash("sha256")
    .update(`${teamSyncViewerKey(viewer)}\n${scope}\n${ownerId ?? ""}`)
    .digest("hex")
    .slice(0, 12);
}

function changeCursor(sequence: number, tag: string): string {
  return `${sequence}.${tag}`;
}

function lastChange(connection: DatabaseSync): number {
  const row = databaseRow(
    connection.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'sync_message_changes'").get(),
  );
  return row ? requiredNumberColumn(row, "seq") : 0;
}

function changeRange(
  connection: DatabaseSync,
  scope: ChangeScope,
  ownerId: string,
  cursor: string,
  tag: string,
): ChangeRange | "reset" {
  const match = /^(\d{1,15})\.([0-9a-f]{12})$/u.exec(cursor);
  const through = lastChange(connection);
  const after = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (match?.[2] !== tag || !Number.isSafeInteger(after) || after > through) return "reset";
  const counted = databaseRow(
    connection
      .prepare(
        `SELECT COUNT(*) AS changed FROM sync_message_changes
         WHERE scope = ? AND owner_id = ? AND sequence > ? AND sequence <= ?`,
      )
      .get(scope, ownerId, after, through),
  );
  if (counted && requiredNumberColumn(counted, "changed") > MAX_SYNC_LOG_CHANGES) return "reset";
  return { after, through };
}
