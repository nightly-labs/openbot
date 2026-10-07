import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import {
  CONVERSATION_CACHE_BYTES_LIMIT,
  CONVERSATION_CACHE_MESSAGE_LIMIT,
  CONVERSATION_CACHE_TOTAL_BYTES_LIMIT,
  ConversationRuntime,
} from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { isRecord, type ThreadItem } from "../src/backend/protocol";
import {
  PROVIDER_HISTORY_PAGE_SIZE,
  type ProviderHistoryFragment,
  type ReadProviderHistory,
} from "../src/backend/provider-history";
import { importProviderHistory } from "../src/backend/provider-history-import";

const BYTES_PER_MIB = 1024 * 1024;
const PER_MESSAGE_BYTES_LIMIT = 256 * BYTES_PER_MIB;
const DEFAULT_TOTAL_BYTES = 260 * BYTES_PER_MIB;
const ITEM_BYTES = 32 * 1024;
const ITEMS_PER_TURN = PROVIDER_HISTORY_PAGE_SIZE;
const REPORT_NAME = "provider-history-report.json";

interface MemorySample {
  rssBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

interface CacheMeasurement {
  cachedConversationCount: number;
  cachedMessageCount: number;
  cachedBytes: number;
}

interface Checkpoint {
  targetHistoryBytes: number;
  stagedHistoryBytes: number;
  stagedStorageBytes: number;
  stagedTurnCount: number;
  stagedItemCount: number;
  importedMessageCount: number;
  pagesRead: number;
  maxPageItems: number;
  scannedItemCount: number;
  cache: CacheMeasurement;
  memoryBefore: MemorySample;
  memoryAfterStage: MemorySample;
  memoryAfterRead: MemorySample;
}

interface Report {
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  limits: {
    perMessageBytes: number;
    providerHistoryPageItems: number;
    cacheMessagesPerConversation: number;
    cacheBytesPerConversation: number;
    cacheBytesProcessWide: number;
  };
  checkpoints: Checkpoint[];
  acceptance: {
    totalHistoryExceedsPerMessageGuard: boolean;
    everyPageWithinLimit: boolean;
    cacheWithinPerConversationLimit: boolean;
    cacheWithinProcessLimit: boolean;
    allStagedItemsScanned: boolean;
    messageImportCountMatchesItems: boolean;
    idempotentDuplicateImport: boolean;
    importCompleted: boolean;
  };
}

interface Options {
  totalBytes: number;
  outputPath: string;
}

/**
 * Runs the bounded history check against the real SQLite staging store and conversation cache.
 *
 * The default total is intentionally above the 256 MiB transport guard. Each page is only 50
 * 32 KiB items, so the benchmark never builds the complete transcript in a JavaScript array.
 */
export async function runProviderHistoryReport(options: Options): Promise<Report> {
  const databaseRoot = await mkdtemp(join(tmpdir(), "openbot-provider-history-report-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "openbot-provider-history-report-home-"));
  const database = new OpenBotDatabase(databaseRoot);
  const agentStore = new AgentStore(databaseRoot, homeRoot, database);
  const sessionId = "provider-history-report-session";
  const agentId = "provider-history-report-agent";
  let threadId: string;
  let runtime: ConversationRuntime | undefined;
  const checkpoints: Checkpoint[] = [];
  let lastFragment: ProviderHistoryFragment | undefined;
  let stagedPayloadBytes = 0;
  let turnCount = 0;

  try {
    await runCauseEffect(agentStore.initialize());
    const agent = await runCauseEffect(
      agentStore.getOrCreate(agentId, "Provider history report", "Provider history report"),
    );
    threadId = await runCauseEffect(agentStore.ensureThreadId(agent.id));
    runtime = createCacheRuntime(agentStore);

    const targets = checkpointTargets(options.totalBytes);
    let nextTarget = 0;
    let memoryBefore = memorySample();
    const readHistory: ReadProviderHistory = (_request, consume) =>
      Effect.gen(function* () {
        while (stagedPayloadBytes < options.totalBytes) {
          memoryBefore = memorySample();
          const turnIndex = turnCount;
          const turnId = `provider-history-report-turn-${String(turnIndex).padStart(8, "0")}`;
          const text = reportItemText(ITEM_BYTES, turnIndex);
          const items: ThreadItem[] = Array.from(
            { length: ITEMS_PER_TURN },
            (_, itemIndex): ThreadItem => ({
              type: "agentMessage",
              id: `${turnId}-item-${String(itemIndex).padStart(2, "0")}`,
              text,
              status: "completed",
            }),
          );
          const fragment: ProviderHistoryFragment = {
            turnId,
            status: "completed",
            startedAt: turnIndex,
            itemOffset: 0,
            items,
            complete: true,
          };
          const payloadBytes = items.reduce((total, item) => total + byteLength(JSON.stringify(item)), 0);
          const keepReading = yield* consume(fragment);
          if (!keepReading) return;
          stagedPayloadBytes += payloadBytes;
          turnCount += 1;
          lastFragment = fragment;

          while (
            nextTarget < targets.length &&
            stagedPayloadBytes >= (targets[nextTarget] ?? Number.POSITIVE_INFINITY)
          ) {
            const target = targets[nextTarget] ?? stagedPayloadBytes;
            const memoryAfterStage = memorySample();
            if (!runtime) throw new Error("Provider history report cache was not initialized.");
            const cache = setLatestPersistedCache(runtime, database, agentId, threadId);
            const scan = scanStagedPages(database, sessionId, turnCount);
            const memoryAfterRead = memorySample();
            checkpoints.push({
              targetHistoryBytes: target,
              stagedHistoryBytes: stagedPayloadBytes,
              stagedStorageBytes: stagedStorageBytes(database, sessionId),
              stagedTurnCount: rowCount(database, "provider_history_turns", "session_id", sessionId),
              stagedItemCount: rowCount(database, "provider_history_staging", "session_id", sessionId),
              importedMessageCount: rowCount(database, "projection_thread_messages", "thread_id", threadId),
              pagesRead: scan.pagesRead,
              maxPageItems: scan.maxPageItems,
              scannedItemCount: scan.scannedItemCount,
              cache,
              memoryBefore,
              memoryAfterStage,
              memoryAfterRead,
            });
            nextTarget += 1;
          }
        }
      });

    const firstImport = await Effect.runPromise(
      importProviderHistory({
        database,
        readHistory,
        sessionId,
        provider: "codex",
        externalSessionId: "provider-history-report-external-session",
        agentId,
        publicThreadId: threadId,
        findDelivery: () => null,
        findMessageDelivery: () => null,
      }),
    );

    if (!lastFragment || nextTarget !== targets.length) {
      throw new Error("Provider history report did not reach every checkpoint.");
    }
    const finalFragment = lastFragment;

    const beforeDuplicate = rowCount(database, "provider_history_staging", "session_id", sessionId);
    const beforeMessages = rowCount(database, "projection_thread_messages", "thread_id", threadId);
    const retryReadHistory: ReadProviderHistory = (_request, consume) => Effect.as(consume(finalFragment), undefined);
    await Effect.runPromise(
      importProviderHistory({
        database,
        readHistory: retryReadHistory,
        sessionId,
        provider: "codex",
        externalSessionId: "provider-history-report-external-session",
        agentId,
        publicThreadId: threadId,
        findDelivery: () => null,
        findMessageDelivery: () => null,
      }),
    );
    const afterDuplicate = rowCount(database, "provider_history_staging", "session_id", sessionId);
    const duplicateImportWasIdempotent =
      beforeDuplicate === afterDuplicate &&
      beforeMessages === rowCount(database, "projection_thread_messages", "thread_id", threadId);

    const final = checkpoints.at(-1);
    if (!final) throw new Error("No provider history checkpoint was recorded.");
    const report: Report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      command: process.argv.join(" "),
      limits: {
        perMessageBytes: PER_MESSAGE_BYTES_LIMIT,
        providerHistoryPageItems: PROVIDER_HISTORY_PAGE_SIZE,
        cacheMessagesPerConversation: CONVERSATION_CACHE_MESSAGE_LIMIT,
        cacheBytesPerConversation: CONVERSATION_CACHE_BYTES_LIMIT,
        cacheBytesProcessWide: CONVERSATION_CACHE_TOTAL_BYTES_LIMIT,
      },
      checkpoints,
      acceptance: {
        totalHistoryExceedsPerMessageGuard: final.stagedHistoryBytes > PER_MESSAGE_BYTES_LIMIT,
        everyPageWithinLimit: checkpoints.every((checkpoint) => checkpoint.maxPageItems <= PROVIDER_HISTORY_PAGE_SIZE),
        cacheWithinPerConversationLimit: checkpoints.every(
          (checkpoint) =>
            checkpoint.cache.cachedMessageCount <= CONVERSATION_CACHE_MESSAGE_LIMIT &&
            checkpoint.cache.cachedBytes <= CONVERSATION_CACHE_BYTES_LIMIT,
        ),
        cacheWithinProcessLimit: checkpoints.every(
          (checkpoint) => checkpoint.cache.cachedBytes <= CONVERSATION_CACHE_TOTAL_BYTES_LIMIT,
        ),
        allStagedItemsScanned: final.scannedItemCount === final.stagedItemCount,
        messageImportCountMatchesItems:
          final.importedMessageCount === firstImport.messages && final.stagedItemCount === firstImport.messages,
        idempotentDuplicateImport: duplicateImportWasIdempotent,
        importCompleted: database.providerHistoryImport(sessionId)?.state === "complete",
      },
    };
    await mkdir(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return report;
  } finally {
    runtime?.dispose();
    database.close();
    await rm(databaseRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
}

function checkpointTargets(totalBytes: number): number[] {
  const requested = Math.max(BYTES_PER_MIB, Math.floor(totalBytes));
  return [...new Set([BYTES_PER_MIB, 16 * BYTES_PER_MIB, 64 * BYTES_PER_MIB, requested])].sort((a, b) => a - b);
}

function reportItemText(bytes: number, seed: number): string {
  const marker = `provider-history-report-${seed.toString(36)}-`;
  return marker.repeat(Math.ceil(bytes / marker.length)).slice(0, bytes);
}

function scanStagedPages(
  database: OpenBotDatabase,
  sessionId: string,
  turnCount: number,
): {
  pagesRead: number;
  maxPageItems: number;
  scannedItemCount: number;
} {
  let pagesRead = 0;
  let maxPageItems = 0;
  let scannedItemCount = 0;
  for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
    const turnId = `provider-history-report-turn-${String(turnIndex).padStart(8, "0")}`;
    let afterIndex = -1;
    for (;;) {
      const page = database.stagedProviderHistoryItems({
        sessionId,
        turnId,
        afterIndex,
        limit: PROVIDER_HISTORY_PAGE_SIZE,
      });
      if (page.length === 0) break;
      pagesRead += 1;
      maxPageItems = Math.max(maxPageItems, page.length);
      scannedItemCount += page.length;
      afterIndex = page.at(-1)?.itemIndex ?? afterIndex;
      if (page.length < PROVIDER_HISTORY_PAGE_SIZE) break;
    }
  }
  return { pagesRead, maxPageItems, scannedItemCount };
}

function rowCount(database: OpenBotDatabase, table: string, column: string, value: string): number {
  const allowed = new Set(["provider_history_turns", "provider_history_staging", "projection_thread_messages"]);
  if (!allowed.has(table) || (column !== "session_id" && column !== "thread_id")) {
    throw new Error("Provider history report requested an invalid count query.");
  }
  const row = database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value);
  if (!isRecord(row) || typeof row.count !== "number")
    throw new Error("Provider history report received an invalid row count.");
  return row.count;
}

function stagedStorageBytes(database: OpenBotDatabase, sessionId: string): number {
  const row = database.connection
    .prepare("SELECT COALESCE(SUM(length(item_json)), 0) AS bytes FROM provider_history_staging WHERE session_id = ?")
    .get(sessionId);
  if (!isRecord(row) || typeof row.bytes !== "number") {
    throw new Error("Provider history report received an invalid staged byte count.");
  }
  return row.bytes;
}

function createCacheRuntime(agentStore: AgentStore): ConversationRuntime {
  return new ConversationRuntime(
    agentStore,
    () => undefined,
    () => agentStore.list(),
  );
}

function setLatestPersistedCache(
  runtime: ConversationRuntime,
  database: OpenBotDatabase,
  agentId: string,
  threadId: string,
): CacheMeasurement {
  const page = database.readConversationPage(agentId, threadId, { type: "latest" }, CONVERSATION_CACHE_MESSAGE_LIMIT);
  const snapshot: ConversationSnapshot = {
    agentId,
    threadId,
    activeTurnId: page.activeTurnId,
    revision: page.revision,
    messages: page.messages,
  };
  runtime.setSnapshot(snapshot.agentId, snapshot);
  return cacheMeasurement(runtime);
}

function cacheMeasurement(runtime: ConversationRuntime): CacheMeasurement {
  const snapshots = [...runtime.activeSnapshots()].map(([, snapshot]) => snapshot);
  return {
    cachedConversationCount: snapshots.length,
    cachedMessageCount: snapshots.reduce((total, snapshot) => total + snapshot.messages.length, 0),
    cachedBytes: snapshots.reduce((total, snapshot) => total + byteLength(JSON.stringify(snapshot)), 0),
  };
}

function memorySample(): MemorySample {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function parseOptions(argv: readonly string[]): Options {
  let totalBytes = DEFAULT_TOTAL_BYTES;
  let outputPath = resolve(process.cwd(), ".openbot-build", REPORT_NAME);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--total-bytes") {
      const value = Number(argv[++index]);
      if (!Number.isSafeInteger(value) || value < BYTES_PER_MIB)
        throw new Error("--total-bytes must be at least 1 MiB.");
      totalBytes = value;
    } else if (argument === "--output") {
      const value = argv[++index];
      if (!value) throw new Error("--output needs a path.");
      outputPath = resolve(process.cwd(), value);
    } else if (argument === "--help") {
      process.stdout.write("Usage: bun scripts/provider-history-report.ts [--total-bytes <bytes>] [--output <path>]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { totalBytes, outputPath };
}

if (import.meta.main) {
  const options = parseOptions(process.argv.slice(2));
  const report = await runProviderHistoryReport(options);
  const final = report.checkpoints.at(-1);
  if (!final || !Object.values(report.acceptance).every(Boolean)) {
    throw new Error(`Provider history report failed acceptance checks: ${options.outputPath}`);
  }
  process.stdout.write(
    `Provider history report: ${final.stagedHistoryBytes} bytes, ${final.pagesRead} pages, ` +
      `${final.cache.cachedBytes} cached bytes. Wrote ${options.outputPath}.\n`,
  );
}
