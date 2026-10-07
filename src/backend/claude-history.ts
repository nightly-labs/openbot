import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import {
  isClaudeCompactionSummary,
  isClaudeInterruptMarker,
  isClaudeLocalCommand,
  isClaudeTaskNotification,
} from "./conversation-snapshots";
import {
  databaseRow,
  optionalNumberColumn,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import { LineTooLongError } from "./jsonl";
import { getString, isRecord, type ThreadItem } from "./protocol";
import { providerFailure } from "./provider-client-effects";
import type {
  ProviderHistoryConsumer,
  ProviderHistoryFragment,
  ProviderHistoryRequest,
  ReadProviderHistory,
} from "./provider-history";

export interface ClaudeHistoryOptions {
  configDirectory?: string;
  projectDirectoryName?: string;
  indexDirectory?: string;
}

export interface ClaudeSessionMessage {
  type: "user" | "assistant" | "system";
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
  parent_agent_id: string | null;
  timestamp?: string;
}

interface ParsedRecord {
  uuid: string;
  type: "user" | "assistant" | "system" | "progress" | "attachment";
  parentUuid?: unknown;
  timestamp?: unknown;
  parentToolUseId?: unknown;
  parent_tool_use_id?: unknown;
  parentAgentId?: unknown;
  parent_agent_id?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  teamName?: unknown;
  subtype?: unknown;
  compactMetadata?: unknown;
  message?: unknown;
}

interface TranscriptRow {
  seq: number;
  uuid: string;
  type: ParsedRecord["type"];
  offset: number;
  length: number;
  session_id: string | null;
}

interface TurnMetadata {
  turnId: string;
  startSeq: number;
  endSeq: number;
  timestamp: string | null;
  finalAnswerUuid: string | null;
}

interface FileIdentity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  prefixHash: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    seq INTEGER PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    offset INTEGER NOT NULL,
    length INTEGER NOT NULL,
    parent_uuid TEXT,
    timestamp TEXT,
    session_id TEXT,
    parent_tool_use_id TEXT,
    parent_agent_id TEXT,
    is_sidechain INTEGER NOT NULL,
    is_meta INTEGER NOT NULL,
    team_name TEXT,
    subtype TEXT,
    compact_metadata TEXT,
    visible_user INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS entries_parent ON entries(parent_uuid);
  CREATE INDEX IF NOT EXISTS entries_type_seq ON entries(type, visible_user, seq);
  CREATE TABLE IF NOT EXISTS selected (seq INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS history_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS turn_metadata (
    turn_id TEXT PRIMARY KEY,
    start_seq INTEGER NOT NULL,
    end_seq INTEGER NOT NULL,
    timestamp TEXT,
    final_answer_uuid TEXT
  );
`;
const MAX_TRANSCRIPT_RECORD_BYTES = 256 * 1024 * 1024;
const MAX_TURN_FRAGMENT_ITEMS = 50;

/** Reads Claude JSONL through a disk index. Message payloads are read one at a time per turn. */
export function claudeHistoryReader(options: ClaudeHistoryOptions = {}): ReadProviderHistory {
  return (request, consume) =>
    Effect.tryPromise({
      try: (signal) => scanClaudeHistory(request, consume, options, signal),
      catch: providerFailure,
    });
}

/** Explicit test boundary for an injected SDK history reader. Production uses claudeHistoryReader. */
export function claudeHistoryFromMessages(
  readMessages: (threadId: string, options?: { dir?: string }) => Promise<readonly ClaudeSessionMessage[]>,
): ReadProviderHistory {
  return (request, consume) =>
    Effect.tryPromise({
      try: async (signal) => {
        const fragments = historyFragments(
          await readMessages(request.threadId, request.cwd ? { dir: request.cwd } : undefined),
          request.items === "full",
        );
        for (const fragment of fragments) {
          if (signal.aborted) throw signal.reason;
          if (!(await Effect.runPromise(consume(fragment), { signal }))) break;
        }
      },
      catch: providerFailure,
    });
}

async function scanClaudeHistory(
  request: ProviderHistoryRequest,
  consume: ProviderHistoryConsumer,
  options: ClaudeHistoryOptions,
  signal: AbortSignal,
): Promise<void> {
  const transcript = await findTranscript(
    request.threadId,
    request.cwd,
    options.configDirectory,
    options.projectDirectoryName,
  );
  if (!transcript) return;
  const indexRoot = options.indexDirectory ?? tmpdir();
  const indexDirectory = join(indexRoot, "openbot-claude-history");
  await mkdir(indexDirectory, { recursive: true });
  const indexPath = join(indexDirectory, `${sanitizeProjectPath(request.threadId)}.sqlite`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) throw signal.reason;
    const before = await fileIdentity(transcript);
    if (!before) return;
    const database = new DatabaseSync(indexPath);
    try {
      database.exec(SCHEMA);
      const stored = readHistoryState(database);
      const committedPrefixHash = stored
        ? await prefixHash(transcript, Math.min(stored.size, PREFIX_FINGERPRINT_BYTES))
        : null;
      const committedScanHash =
        stored && before.size >= stored.scanOffset ? await scanBoundaryHash(transcript, stored.scanOffset) : null;
      const reset =
        stored === null
          ? true
          : stored.dev !== before.dev ||
            stored.ino !== before.ino ||
            before.size < stored.size ||
            before.size < stored.scanOffset ||
            committedPrefixHash !== stored.prefixHash ||
            committedScanHash !== stored.scanHash ||
            (before.size === stored.scanOffset && before.mtimeMs !== stored.mtimeMs);
      if (reset) resetIndex(database);
      const startOffset = reset ? 0 : (stored?.scanOffset ?? 0);
      const nextOffset = await buildIndex(transcript, database, startOffset, before.size, before, signal);
      const after = await fileIdentity(transcript);
      const afterCommittedPrefixHash = after
        ? await prefixHash(transcript, Math.min(before.size, PREFIX_FINGERPRINT_BYTES))
        : null;
      if (!after || changed(before, after) || afterCommittedPrefixHash !== before.prefixHash) {
        resetIndex(database);
        continue;
      }
      writeHistoryState(database, after, nextOffset, await scanBoundaryHash(transcript, nextOffset));
      await selectConversation(database, signal);
      await populateTurnMetadata(database, transcript, request.items === "full", signal);
      if (request.items === "none") await emitMetadata(database, consume, signal);
      else await emitTurns(database, transcript, consume, signal);
      return;
    } finally {
      database.close();
    }
  }
  throw new Error("Claude transcript changed while it was being read.");
}

async function buildIndex(
  filePath: string,
  database: DatabaseSync,
  startOffset: number,
  fileSize: number,
  identity: FileIdentity,
  signal: AbortSignal,
): Promise<number> {
  const insert = database.prepare(
    `INSERT INTO entries
      (uuid, type, offset, length, parent_uuid, timestamp, session_id, parent_tool_use_id,
       parent_agent_id, is_sidechain, is_meta, team_name, subtype, compact_metadata, visible_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let nextOffset = startOffset;
  let lineNumber = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    for await (const record of readTranscriptLines(filePath, signal, startOffset, fileSize)) {
      if (signal.aborted) throw signal.reason;
      const parsed = record.complete ? parseRecord(record.line.trim()) : null;
      if (parsed) {
        const text = messageText(parsed.message);
        const visibleUser =
          parsed.type === "user" &&
          text.length > 0 &&
          !isClaudeInterruptMarker(text) &&
          !isClaudeCompactionSummary(text) &&
          !messageHasToolResult(parsed.message)
            ? 1
            : 0;
        insert.run(
          parsed.uuid,
          parsed.type,
          record.offset,
          record.byteLength,
          stringOrNull(parsed.parentUuid),
          stringOrNull(parsed.timestamp),
          stringOrNull(parsed.sessionId ?? parsed.session_id),
          stringOrNull(parsed.parentToolUseId ?? parsed.parent_tool_use_id),
          stringOrNull(parsed.parentAgentId ?? parsed.parent_agent_id),
          parsed.isSidechain === true ? 1 : 0,
          parsed.isMeta === true ? 1 : 0,
          stringOrNull(parsed.teamName),
          stringOrNull(parsed.subtype),
          isRecord(parsed.compactMetadata) ? JSON.stringify(parsed.compactMetadata) : null,
          visibleUser,
        );
      }
      nextOffset = record.complete ? record.offset + record.byteLength + 1 : record.offset;
      lineNumber += 1;
      if (lineNumber % 256 === 0) await new Promise<void>((resume) => setImmediate(resume));
    }
    writeHistoryState(database, identity, nextOffset, await scanBoundaryHash(filePath, nextOffset));
    database.exec("COMMIT");
    return nextOffset;
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
}

async function* readTranscriptLines(
  filePath: string,
  signal: AbortSignal,
  startOffset: number,
  endOffset: number,
): AsyncGenerator<{ line: string; byteLength: number; complete: boolean; offset: number }> {
  if (startOffset >= endOffset) return;
  const input = createReadStream(filePath, { encoding: "utf8", start: startOffset, end: endOffset - 1 });
  let carry = "";
  let offset = startOffset;
  try {
    for await (const chunk of input) {
      if (signal.aborted) throw signal.reason;
      carry += chunk;
      if (Buffer.byteLength(carry) > MAX_TRANSCRIPT_RECORD_BYTES) {
        throw new LineTooLongError("Claude");
      }
      let newline = carry.indexOf("\n");
      while (newline >= 0) {
        const rawLine = carry.slice(0, newline);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        const byteLength = Buffer.byteLength(rawLine);
        yield { line, byteLength, complete: true, offset };
        offset += byteLength + 1;
        carry = carry.slice(newline + 1);
        newline = carry.indexOf("\n");
      }
    }
    if (carry.length > 0) yield { line: carry, byteLength: Buffer.byteLength(carry), complete: false, offset };
  } finally {
    input.destroy();
  }
}

interface HistoryState extends FileIdentity {
  scanOffset: number;
  scanHash: string;
}

function readHistoryState(database: DatabaseSync): HistoryState | null {
  const read = database.prepare("SELECT key, value FROM history_meta");
  let devValue: string | undefined;
  let inoValue: string | undefined;
  let sizeValue: string | undefined;
  let mtimeValue: string | undefined;
  let prefixHashValue: string | undefined;
  let offsetValue: string | undefined;
  let scanHashValue: string | undefined;
  for (const raw of read.iterate()) {
    const row = databaseRow(raw);
    if (!row) throw new Error("Invalid Claude history index row.");
    const key = requiredStringColumn(row, "key");
    const value = requiredStringColumn(row, "value");
    if (key === "dev") devValue = value;
    else if (key === "ino") inoValue = value;
    else if (key === "size") sizeValue = value;
    else if (key === "mtime_ms") mtimeValue = value;
    else if (key === "prefix_hash") prefixHashValue = value;
    else if (key === "scan_offset") offsetValue = value;
    else if (key === "scan_hash") scanHashValue = value;
  }
  if (
    devValue === undefined ||
    inoValue === undefined ||
    sizeValue === undefined ||
    mtimeValue === undefined ||
    prefixHashValue === undefined ||
    offsetValue === undefined ||
    scanHashValue === undefined
  )
    return null;
  const dev = Number(devValue);
  const ino = Number(inoValue);
  const size = Number(sizeValue);
  const mtimeMs = Number(mtimeValue);
  const scanOffset = Number(offsetValue);
  if (![dev, ino, size, mtimeMs, scanOffset].every(Number.isFinite))
    throw new Error("Invalid Claude history index metadata.");
  return { dev, ino, size, mtimeMs, prefixHash: prefixHashValue, scanOffset, scanHash: scanHashValue };
}

function writeHistoryState(database: DatabaseSync, identity: FileIdentity, scanOffset: number, scanHash: string): void {
  const write = database.prepare(
    "INSERT INTO history_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of [
    ["dev", identity.dev],
    ["ino", identity.ino],
    ["size", identity.size],
    ["mtime_ms", identity.mtimeMs],
    ["prefix_hash", identity.prefixHash],
    ["scan_offset", scanOffset],
    ["scan_hash", scanHash],
  ] as const) {
    write.run(key, String(value));
  }
}

function resetIndex(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM entries; DELETE FROM selected; DELETE FROM turn_metadata; DELETE FROM history_meta;");
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
}

async function selectConversation(database: DatabaseSync, signal: AbortSignal): Promise<void> {
  const updateParent = database.prepare("UPDATE entries SET parent_uuid = ? WHERE uuid = ?");
  const existsById = database.prepare("SELECT 1 FROM entries WHERE uuid = ?");
  for (const raw of database
    .prepare("SELECT compact_metadata FROM entries WHERE subtype = 'compact_boundary'")
    .iterate()) {
    const row = databaseRow(raw);
    if (!row) throw new Error("Invalid Claude history compaction row.");
    const compactMetadata = optionalStringColumn(row, "compact_metadata");
    if (!compactMetadata) continue;
    let metadata: unknown;
    try {
      metadata = JSON.parse(compactMetadata);
    } catch {
      continue;
    }
    if (!isRecord(metadata)) continue;
    const preserved = metadata.preservedMessages;
    if (isRecord(preserved) && Array.isArray(preserved.uuids)) {
      const ids = preserved.uuids.filter((value): value is string => typeof value === "string");
      const anchor = stringOrNull(preserved.anchorUuid);
      const firstId = ids[0];
      if (!anchor || !firstId || !ids.every((id) => existsById.get(id))) continue;
      let parent = anchor;
      for (const id of ids) {
        updateParent.run(parent, id);
        parent = id;
      }
      database
        .prepare("UPDATE entries SET parent_uuid = ? WHERE parent_uuid = ? AND uuid <> ?")
        .run(parent, anchor, firstId);
    } else if (isRecord(metadata.preservedSegment)) {
      const segment = metadata.preservedSegment;
      const head = stringOrNull(segment.headUuid);
      const anchor = stringOrNull(segment.anchorUuid);
      const tail = stringOrNull(segment.tailUuid);
      if (!head || !anchor || !tail || !existsById.get(head)) continue;
      updateParent.run(anchor, head);
      database
        .prepare("UPDATE entries SET parent_uuid = ? WHERE parent_uuid = ? AND uuid <> ?")
        .run(tail, anchor, head);
    }
  }
  database.exec("DELETE FROM selected");
  const leafRaw = database
    .prepare(
      `SELECT e.uuid FROM entries e
       WHERE NOT EXISTS (SELECT 1 FROM entries child WHERE child.parent_uuid = e.uuid)
       AND e.type IN ('user', 'assistant') AND e.is_sidechain = 0 AND e.is_meta = 0 AND e.team_name IS NULL
       ORDER BY e.seq DESC LIMIT 1`,
    )
    .get();
  const leafRow = leafRaw === undefined ? null : databaseRow(leafRaw);
  const leaf = leafRow ? requiredStringColumn(leafRow, "uuid") : null;
  const fallback =
    leaf ??
    (() => {
      const raw = database
        .prepare(
          `SELECT e.uuid FROM entries e
         WHERE NOT EXISTS (SELECT 1 FROM entries child WHERE child.parent_uuid = e.uuid)
         ORDER BY e.seq DESC LIMIT 1`,
        )
        .get();
      const row = raw === undefined ? null : databaseRow(raw);
      return row ? requiredStringColumn(row, "uuid") : null;
    })();
  if (!fallback) return;
  const insertSelected = database.prepare(
    "INSERT OR IGNORE INTO selected (seq) SELECT seq FROM entries WHERE uuid = ?",
  );
  const parentOf = database.prepare("SELECT parent_uuid FROM entries WHERE uuid = ?");
  let uuid: string | null = fallback;
  let steps = 0;
  while (uuid) {
    if (signal.aborted) throw signal.reason;
    const insertion = insertSelected.run(uuid);
    if (Number(insertion.changes) !== 1) {
      if (databaseRow(parentOf.get(uuid))) throw new Error("Claude transcript contains a parent cycle.");
      break;
    }
    const parentRow = databaseRow(parentOf.get(uuid));
    uuid = parentRow ? optionalStringColumn(parentRow, "parent_uuid") : null;
    steps += 1;
    if (steps % 256 === 0) await new Promise<void>((resume) => setImmediate(resume));
  }
  database.exec(
    `INSERT OR IGNORE INTO selected (seq)
     SELECT child.seq FROM entries child
     JOIN entries parent ON parent.uuid = child.parent_uuid
     JOIN selected selected_parent ON selected_parent.seq = parent.seq
     WHERE child.type = 'user' AND child.visible_user = 0`,
  );
}

async function populateTurnMetadata(
  database: DatabaseSync,
  filePath: string,
  includeAnswerMetadata: boolean,
  signal: AbortSignal,
): Promise<void> {
  const turnRows = database.prepare(
    `SELECT e.seq, e.uuid, e.timestamp FROM entries e JOIN selected s ON s.seq = e.seq
     WHERE e.type = 'user' AND e.visible_user = 1 ORDER BY e.seq`,
  );
  const nextTurn = database.prepare(
    `SELECT MIN(e.seq) AS seq FROM entries e JOIN selected s ON s.seq = e.seq
     WHERE e.type = 'user' AND e.visible_user = 1 AND e.seq > ?`,
  );
  const insert = database.prepare(
    "INSERT OR REPLACE INTO turn_metadata (turn_id, start_seq, end_seq, timestamp, final_answer_uuid) VALUES (?, ?, ?, ?, ?)",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM turn_metadata");
    const file = includeAnswerMetadata ? await open(filePath, "r") : null;
    try {
      for (const raw of turnRows.iterate()) {
        if (signal.aborted) throw signal.reason;
        const row = decodeTurnRow(raw);
        const nextRaw = nextTurn.get(row.seq);
        const next = nextRaw === undefined ? null : databaseRow(nextRaw);
        const endSeq = next ? (optionalNumberColumn(next, "seq") ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const finalAnswerUuid = file ? await findFinalAnswer(database, file, row.seq, endSeq, signal) : null;
        insert.run(row.uuid, row.seq, endSeq, row.timestamp, finalAnswerUuid);
      }
    } finally {
      if (file) await file.close();
    }
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
}

async function findFinalAnswer(
  database: DatabaseSync,
  file: Awaited<ReturnType<typeof open>>,
  startSeq: number,
  endSeq: number,
  signal: AbortSignal,
): Promise<string | null> {
  let finalAnswerUuid: string | null = null;
  const statement = database.prepare(
    `SELECT e.seq, e.uuid, e.type, e.offset, e.length, e.session_id
     FROM entries e JOIN selected s ON s.seq = e.seq
     WHERE e.seq >= ? AND e.seq < ? AND e.is_sidechain = 0 AND e.is_meta = 0 AND e.team_name IS NULL ORDER BY e.seq`,
  );
  for (const raw of statement.iterate(startSeq, endSeq)) {
    if (signal.aborted) throw signal.reason;
    const row = decodeTranscriptRow(raw);
    const message = await readMessage(file, row);
    if (message?.type !== "assistant") continue;
    const text = messageText(message.message);
    const thinking = messageThinking(message.message);
    const endsStep = messageToolCalls(message.message).length > 0;
    if (!thinking && !text && !endsStep) continue;
    const beforeThinking = thinking ? textBeforeThinking(message.message) : "";
    if (thinking) finalAnswerUuid = null;
    if (text.slice(beforeThinking.length)) finalAnswerUuid = message.uuid;
    if (endsStep) finalAnswerUuid = null;
  }
  return finalAnswerUuid;
}

async function emitMetadata(
  database: DatabaseSync,
  consume: ProviderHistoryConsumer,
  signal: AbortSignal,
): Promise<void> {
  let cursor = Number.MAX_SAFE_INTEGER;
  const statement = database.prepare(
    "SELECT turn_id, start_seq, end_seq, timestamp, final_answer_uuid FROM turn_metadata WHERE start_seq < ? ORDER BY start_seq DESC LIMIT 1",
  );
  for (;;) {
    if (signal.aborted) throw signal.reason;
    const raw = statement.get(cursor);
    if (raw === undefined) return;
    const row = decodeTurnMetadata(raw);
    cursor = row.startSeq;
    if (
      !(await Effect.runPromise(
        consume({
          turnId: row.turnId,
          status: "completed",
          startedAt: turnStartedAt(row.timestamp, row.startSeq),
          items: [],
          complete: true,
        }),
        { signal },
      ))
    )
      return;
  }
}

async function emitTurns(
  database: DatabaseSync,
  filePath: string,
  consume: ProviderHistoryConsumer,
  signal: AbortSignal,
): Promise<void> {
  let cursor = Number.MAX_SAFE_INTEGER;
  const statement = database.prepare(
    "SELECT turn_id, start_seq, end_seq, timestamp, final_answer_uuid FROM turn_metadata WHERE start_seq < ? ORDER BY start_seq DESC LIMIT 1",
  );
  for (;;) {
    if (signal.aborted) throw signal.reason;
    const raw = statement.get(cursor);
    if (raw === undefined) return;
    const row = decodeTurnMetadata(raw);
    cursor = row.startSeq;
    if (!(await emitTurnFragments(database, filePath, row, consume, signal))) return;
  }
}

async function emitTurnFragments(
  database: DatabaseSync,
  filePath: string,
  turn: TurnMetadata,
  consume: ProviderHistoryConsumer,
  signal: AbortSignal,
): Promise<boolean> {
  const file = await open(filePath, "r");
  let items: ThreadItem[] = [];
  let itemOffset = 0;
  let stopped = false;
  const flush = async (complete: boolean): Promise<boolean> => {
    if (signal.aborted) throw signal.reason;
    const count = items.length;
    const result = await Effect.runPromise(
      consume({
        turnId: turn.turnId,
        status: "completed",
        startedAt: turnStartedAt(turn.timestamp, turn.startSeq),
        itemOffset,
        items,
        complete,
      }),
      { signal },
    );
    items = [];
    itemOffset += count;
    return result;
  };
  const addItem = async (item: ThreadItem): Promise<boolean> => {
    items.push(item);
    if (items.length < MAX_TURN_FRAGMENT_ITEMS) return true;
    const result = await flush(false);
    if (!result) stopped = true;
    return result;
  };
  try {
    const statement = database.prepare(
      `SELECT e.seq, e.uuid, e.type, e.offset, e.length, e.session_id
       FROM entries e JOIN selected s ON s.seq = e.seq
       WHERE e.seq >= ? AND e.seq < ? AND e.is_sidechain = 0 AND e.is_meta = 0 AND e.team_name IS NULL ORDER BY e.seq`,
    );
    for (const raw of statement.iterate(turn.startSeq, turn.endSeq)) {
      if (signal.aborted) throw signal.reason;
      const row = decodeTranscriptRow(raw);
      const message = await readMessage(file, row);
      if (!message) continue;
      const text = messageText(message.message);
      if (message.type === "user") {
        const toolResults = messageToolResults(message.message);
        for (const result of toolResults) {
          if (
            !(await addItem({
              id: result.id,
              type: "toolCall",
              status: "completed",
              ...(result.text ? { text: result.text } : {}),
            }))
          )
            break;
        }
        if (toolResults.length > 0) {
          if (stopped) break;
          continue;
        }
        if (
          row.seq !== turn.startSeq ||
          !text ||
          isClaudeInterruptMarker(text) ||
          isClaudeTaskNotification(text) ||
          isClaudeLocalCommand(text)
        )
          continue;
        if (
          !(await addItem({
            id: message.uuid,
            type: "userMessage",
            clientId: message.uuid,
            content: [{ type: "text", text }],
          }))
        )
          break;
        continue;
      }
      if (message.type !== "assistant") continue;
      const thinking = messageThinking(message.message);
      const endsStep = messageToolCalls(message.message).length > 0;
      if (!thinking && !text && !endsStep) continue;
      const beforeThinking = thinking ? textBeforeThinking(message.message) : "";
      if (thinking) {
        if (
          beforeThinking &&
          !(await addItem({
            id: `${message.uuid}:narration`,
            type: "agentMessage",
            phase: "commentary",
            text: beforeThinking,
          }))
        )
          break;
        if (
          !(await addItem({
            id: `${message.uuid}:reasoning`,
            type: "agentMessage",
            phase: "commentary",
            text: thinking,
          }))
        )
          break;
      }
      const answerText = text.slice(beforeThinking.length);
      if (answerText) {
        const phase = message.uuid === turn.finalAnswerUuid && !endsStep ? undefined : "commentary";
        if (!(await addItem({ id: message.uuid, type: "agentMessage", ...(phase ? { phase } : {}), text: answerText })))
          break;
      }
      for (const toolCall of messageToolCalls(message.message)) {
        if (!(await addItem({ id: toolCall.id, type: "toolCall", name: toolCall.name, status: "in_progress" }))) break;
      }
      if (stopped) break;
    }
    if (stopped) return false;
    return await flush(true);
  } finally {
    await file.close();
  }
}

function decodeTurnRow(raw: unknown): { seq: number; uuid: string; timestamp: string | null } {
  const row = databaseRow(raw);
  if (!row) throw new Error("Invalid Claude history turn row.");
  return {
    seq: requiredNumberColumn(row, "seq"),
    uuid: requiredStringColumn(row, "uuid"),
    timestamp: optionalStringColumn(row, "timestamp"),
  };
}

function decodeTurnMetadata(raw: unknown): TurnMetadata {
  const row = databaseRow(raw);
  if (!row) throw new Error("Invalid Claude history metadata row.");
  const finalAnswerUuid = optionalStringColumn(row, "final_answer_uuid");
  return {
    turnId: requiredStringColumn(row, "turn_id"),
    startSeq: requiredNumberColumn(row, "start_seq"),
    endSeq: requiredNumberColumn(row, "end_seq"),
    timestamp: optionalStringColumn(row, "timestamp"),
    finalAnswerUuid,
  };
}

function decodeTranscriptRow(raw: unknown): TranscriptRow {
  const row = databaseRow(raw);
  if (!row) throw new Error("Invalid Claude history transcript row.");
  const type = requiredStringColumn(row, "type");
  if (type !== "user" && type !== "assistant" && type !== "system" && type !== "progress" && type !== "attachment") {
    throw new Error("Invalid Claude history transcript type.");
  }
  return {
    seq: requiredNumberColumn(row, "seq"),
    uuid: requiredStringColumn(row, "uuid"),
    type,
    offset: requiredNumberColumn(row, "offset"),
    length: requiredNumberColumn(row, "length"),
    session_id: optionalStringColumn(row, "session_id"),
  };
}

async function readMessage(
  file: Awaited<ReturnType<typeof open>>,
  row: TranscriptRow,
): Promise<ClaudeSessionMessage | null> {
  const buffer = Buffer.allocUnsafe(row.length);
  const result = await file.read(buffer, 0, row.length, row.offset);
  if (result.bytesRead !== row.length) throw new Error("Claude transcript changed while it was being read.");
  const parsed = parseRecord(buffer.toString("utf8"));
  if (!parsed || (parsed.type !== "user" && parsed.type !== "assistant" && parsed.type !== "system")) return null;
  return {
    type: parsed.type,
    uuid: parsed.uuid,
    session_id: stringOrNull(parsed.sessionId ?? parsed.session_id) ?? row.session_id ?? "",
    message: parsed.message,
    parent_tool_use_id: stringOrNull(parsed.parentToolUseId ?? parsed.parent_tool_use_id),
    parent_agent_id: stringOrNull(parsed.parentAgentId ?? parsed.parent_agent_id),
    ...(parsed.timestamp ? { timestamp: String(parsed.timestamp) } : {}),
  };
}

function historyFragments(messages: readonly ClaudeSessionMessage[], includeItems: boolean): ProviderHistoryFragment[] {
  const fragments: ProviderHistoryFragment[] = [];
  let current: ProviderHistoryFragment | null = null;
  let currentThinking: ThreadItem | null = null;
  let currentAnswer: ThreadItem | null = null;
  let skippingCompaction = false;
  for (const [messageIndex, message] of messages.entries()) {
    const text = messageText(message.message);
    if (message.type === "user") {
      if (!text || isClaudeInterruptMarker(text)) continue;
      if (isClaudeCompactionSummary(text)) {
        skippingCompaction = true;
        current = null;
        currentThinking = null;
        currentAnswer = null;
        continue;
      }
      skippingCompaction = false;
      current = {
        turnId: message.uuid,
        status: "completed",
        startedAt: turnStartedAt(message.timestamp, messageIndex),
        items: [],
        complete: true,
      };
      fragments.push(current);
      currentThinking = null;
      currentAnswer = null;
      if (includeItems && !isClaudeTaskNotification(text) && !isClaudeLocalCommand(text))
        current.items.push({
          id: message.uuid,
          type: "userMessage",
          clientId: message.uuid,
          content: [{ type: "text", text }],
        });
      continue;
    }
    if (message.type !== "assistant" || skippingCompaction) continue;
    const thinking = messageThinking(message.message);
    const endsStep = messageToolCalls(message.message).length > 0;
    if (!thinking && !text && !endsStep) continue;
    current ??= {
      turnId: message.uuid,
      status: "completed",
      startedAt: turnStartedAt(message.timestamp, messageIndex),
      items: [],
      complete: true,
    };
    if (!fragments.includes(current)) fragments.push(current);
    if (!includeItems) continue;
    const beforeThinking = thinking ? textBeforeThinking(message.message) : "";
    if (thinking) {
      if (currentAnswer) {
        currentAnswer.phase = "commentary";
        currentAnswer = null;
      }
      if (beforeThinking)
        current.items.push({
          id: `${message.uuid}:narration`,
          type: "agentMessage",
          phase: "commentary",
          text: beforeThinking,
        });
      if (currentThinking) currentThinking.text = `${currentThinking.text ?? ""}\n${thinking}`;
      else {
        currentThinking = {
          id: `${current.turnId}:reasoning`,
          type: "agentMessage",
          phase: "commentary",
          text: thinking,
        };
        current.items.push(currentThinking);
      }
    }
    const answerText = text.slice(beforeThinking.length);
    if (answerText) {
      if (currentAnswer) currentAnswer.phase = "commentary";
      currentAnswer = { id: message.uuid, type: "agentMessage", text: answerText };
      current.items.push(currentAnswer);
    }
    if (endsStep && currentAnswer) {
      currentAnswer.phase = "commentary";
      currentAnswer = null;
    }
  }
  return fragments.reverse();
}

async function findTranscript(
  threadId: string,
  cwd: string | undefined,
  configuredDirectory: string | undefined,
  configuredProjectName: string | undefined,
): Promise<string | null> {
  const root = configuredDirectory ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const projects = join(root, "projects");
  const projectName =
    configuredProjectName ??
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME ??
    (cwd ? sanitizeProjectPath(resolve(cwd)) : undefined);
  if (projectName) {
    const exact = join(projects, projectName, `${threadId}.jsonl`);
    if (await exists(exact)) return exact;
  }
  let directories: string[];
  try {
    directories = (await readdir(projects, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  for (const directory of directories) {
    const candidate = join(projects, directory, `${threadId}.jsonl`);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function parseRecord(line: string): ParsedRecord | null {
  try {
    const value = JSON.parse(line);
    if (!isRecord(value) || typeof value.uuid !== "string" || typeof value.type !== "string") return null;
    const type = value.type;
    if (type !== "user" && type !== "assistant" && type !== "system" && type !== "progress" && type !== "attachment")
      return null;
    return {
      uuid: value.uuid,
      type,
      parentUuid: value.parentUuid,
      timestamp: value.timestamp,
      parentToolUseId: value.parentToolUseId,
      parent_tool_use_id: value.parent_tool_use_id,
      parentAgentId: value.parentAgentId,
      parent_agent_id: value.parent_agent_id,
      sessionId: value.sessionId,
      session_id: value.session_id,
      isSidechain: value.isSidechain,
      isMeta: value.isMeta,
      teamName: value.teamName,
      subtype: value.subtype,
      compactMetadata: value.compactMetadata,
      message: value.message,
    };
  } catch {
    return null;
  }
}

function sanitizeProjectPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n");
}

function textBeforeThinking(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return "";
  const blocks = message.content.filter(isRecord);
  const boundary = blocks.findIndex((block) => block.type === "thinking");
  if (boundary < 0) return "";
  const before = blocks
    .slice(0, boundary)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text));
  if (before.length === 0) return "";
  const follows = blocks.slice(boundary + 1).some((block) => block.type === "text" && typeof block.text === "string");
  return `${before.join("\n")}${follows ? "\n" : ""}`;
}

function messageThinking(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "thinking")
    .map((block) => getString(block, "thinking"))
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function messageToolCalls(message: unknown): Array<{ id: string; name: string }> {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord).flatMap((block) => {
    const id = getString(block, "id");
    const name = getString(block, "name");
    return block.type === "tool_use" && id && name ? [{ id, name }] : [];
  });
}

function messageHasToolResult(message: unknown): boolean {
  if (!isRecord(message) || !Array.isArray(message.content)) return false;
  return message.content.some((block) => isRecord(block) && block.type === "tool_result");
}

function messageToolResults(message: unknown): Array<{ id: string; text: string }> {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord).flatMap((block) => {
    const id = getString(block, "tool_use_id");
    if (block.type !== "tool_result" || !id) return [];
    const content = block.content;
    if (typeof content === "string") return [{ id, text: content }];
    if (!Array.isArray(content)) return [{ id, text: "" }];
    const text = content
      .filter(isRecord)
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join("\n");
    return [{ id, text }];
  });
}

function timestampSeconds(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp / 1_000 : undefined;
}

function turnStartedAt(timestamp: string | null | undefined, sequence: number): number {
  return timestampSeconds(timestamp) ?? sequence;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function fileIdentity(filePath: string): Promise<FileIdentity | null> {
  try {
    const value = await stat(filePath);
    return {
      dev: value.dev,
      ino: value.ino,
      size: value.size,
      mtimeMs: value.mtimeMs,
      prefixHash: await prefixHash(filePath, Math.min(value.size, PREFIX_FINGERPRINT_BYTES)),
    };
  } catch {
    return null;
  }
}

function changed(before: FileIdentity, after: FileIdentity): boolean {
  return (
    before.dev !== after.dev || before.ino !== after.ino || after.size < before.size || after.mtimeMs < before.mtimeMs
  );
}

const PREFIX_FINGERPRINT_BYTES = 64 * 1024;
const SCAN_FINGERPRINT_BYTES = 4 * 1024;

async function prefixHash(filePath: string, length: number): Promise<string> {
  if (length <= 0) return createHash("sha256").digest("hex");
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const result = await file.read(buffer, 0, length, 0);
    return createHash("sha256").update(buffer.subarray(0, result.bytesRead)).digest("hex");
  } finally {
    await file.close();
  }
}

async function scanBoundaryHash(filePath: string, offset: number): Promise<string> {
  if (offset <= 0) return createHash("sha256").digest("hex");
  const file = await open(filePath, "r");
  try {
    const start = Math.max(0, offset - SCAN_FINGERPRINT_BYTES);
    const buffer = Buffer.allocUnsafe(offset - start);
    const result = await file.read(buffer, 0, buffer.length, start);
    return createHash("sha256").update(buffer.subarray(0, result.bytesRead)).digest("hex");
  } finally {
    await file.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
