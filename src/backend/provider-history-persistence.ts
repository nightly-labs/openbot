import { Effect } from "effect";
import type { AcpHistoryPersistence } from "./acp-client";
import type { AgentProvider } from "./agent-client";
import { databaseRow, optionalStringColumn, requiredStringColumn } from "./database/database-rows";
import type { ProviderHistoryTurnCursor } from "./database/provider-history-store";
import type { OpenBotDatabase } from "./openbot-database";
import { providerSync } from "./provider-client-effects";
import type { ProviderHistoryConsumer, ProviderHistoryRequest } from "./provider-history";

/** Builds the ACP history port from SQLite without exposing the database to a provider process. */
export function providerHistoryPersistence(database: OpenBotDatabase, provider: AgentProvider): AcpHistoryPersistence {
  const recordsOnly = provider !== "codex" && provider !== "claude";
  const findSession = (externalSessionId: string) => {
    const row = database.connection
      .prepare(
        `SELECT session_id, state, thread_id
         FROM provider_history_imports
         WHERE provider = ? AND external_session_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(provider, externalSessionId);
    const value = databaseRow(row);
    if (!value) return null;
    return {
      sessionId: requiredStringColumn(value, "session_id"),
      state: requiredStringColumn(value, "state"),
      threadId: optionalStringColumn(value, "thread_id"),
    };
  };

  const findProviderSession = (externalSessionId: string) => {
    const row = database.connection
      .prepare(
        `SELECT id, thread_id
         FROM projection_provider_sessions
         WHERE provider = ? AND external_session_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(provider, externalSessionId);
    const value = databaseRow(row);
    if (!value) return null;
    return {
      sessionId: requiredStringColumn(value, "id"),
      threadId: requiredStringColumn(value, "thread_id"),
    };
  };

  const read = (request: ProviderHistoryRequest, consume: ProviderHistoryConsumer) =>
    Effect.gen(function* () {
      if (request.providerOnly) return;
      const session = yield* providerSync(() => findSession(request.threadId));
      if (!session) return;
      let after: ProviderHistoryTurnCursor | undefined;
      for (;;) {
        const page = yield* providerSync(() =>
          database.stagedProviderHistoryTurnPage(session.sessionId, {
            ...(after === undefined ? {} : { after }),
            limit: 50,
          }),
        );
        for (const turn of page.turns) {
          if (request.items === "none") {
            if (
              !(yield* consume({
                turnId: turn.turnId,
                ...(turn.status === null ? {} : { status: turn.status }),
                ...(turn.startedAt === null ? {} : { startedAt: turn.startedAt }),
                ...(recordsOnly ? { recordsOnly: true } : {}),
                complete: turn.complete,
                items: [],
              }))
            )
              return;
            continue;
          }
          let afterIndex = -1;
          for (;;) {
            const items = yield* providerSync(() =>
              database.stagedProviderHistoryItems({
                sessionId: session.sessionId,
                turnId: turn.turnId,
                afterIndex,
                limit: 50,
              }),
            );
            if (items.length === 0) {
              if (
                !(yield* consume({
                  turnId: turn.turnId,
                  ...(turn.status === null ? {} : { status: turn.status }),
                  ...(turn.startedAt === null ? {} : { startedAt: turn.startedAt }),
                  ...(recordsOnly ? { recordsOnly: true } : {}),
                  items: [],
                  itemOffset: afterIndex + 1,
                  complete: turn.complete,
                }))
              )
                return;
              break;
            }
            const last = items.at(-1);
            const complete = items.length < 50 && turn.complete;
            if (
              !(yield* consume({
                turnId: turn.turnId,
                ...(turn.status === null ? {} : { status: turn.status }),
                ...(turn.startedAt === null ? {} : { startedAt: turn.startedAt }),
                ...(recordsOnly ? { recordsOnly: true } : {}),
                items: items.map(({ item }) => item),
                itemOffset: items[0]?.itemIndex ?? afterIndex + 1,
                complete,
              }))
            )
              return;
            if (complete || !last || last.itemIndex <= afterIndex) break;
            afterIndex = last.itemIndex;
          }
        }
        if (!page.nextCursor) return;
        after = page.nextCursor;
      }
    });

  return {
    read,
    complete: (request) => providerSync(() => findSession(request.threadId)?.state === "complete"),
    append: (externalSessionId, fragment) =>
      providerSync(() => {
        const existing = findSession(externalSessionId);
        if (existing) {
          database.stageProviderHistoryFragment({ sessionId: existing.sessionId, fragment });
          return;
        }
        const providerSession = findProviderSession(externalSessionId);
        if (!providerSession) {
          throw new Error(`Unknown provider session for ACP history append: ${externalSessionId}`);
        }
        database.ensureProviderHistoryImport({
          sessionId: providerSession.sessionId,
          threadId: providerSession.threadId,
          provider,
          externalSessionId,
        });
        database.stageProviderHistoryFragment({ sessionId: providerSession.sessionId, fragment });
      }),
  };
}
