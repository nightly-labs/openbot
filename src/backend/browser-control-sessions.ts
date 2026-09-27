import type { BrowserControlSession, BrowserControlState } from "@openbot/contracts/ipc";
import { browserControlAction, browserControlDetailAction, controlSessionId } from "./browser-control";
import type { BrowserToolCall } from "./browser-tools";
import type { DynamicToolCallParams } from "./protocol";

/**
 * Owns the record of which agent turn is controlling the browser: one session per thread and turn,
 * `acting` while a browser tool call runs and `waiting` for a short grace after it, so the controls
 * the user sees do not flicker between two calls of the same turn. It never imports `BrowserHost`.
 */
export class BrowserControlSessions {
  static readonly IDLE_GRACE_MS = 1_200;
  readonly #sessions = new Map<string, BrowserControlSession>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #listeners = new Set<(state: BrowserControlState) => void>();

  onChanged(listener: (state: BrowserControlState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  state(): BrowserControlState {
    return {
      sessions: [...this.#sessions.values()]
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
        .map((session) => ({ ...session })),
    };
  }

  end(threadId: string, turnId: string): void {
    const id = controlSessionId(threadId, turnId);
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    if (!this.#sessions.delete(id)) return;
    this.#emitChanged();
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    if (this.#sessions.size === 0) return;
    this.#sessions.clear();
    this.#emitChanged();
  }

  /** Ends every session, then drops the listeners. The host calls it once, on shutdown. */
  dispose(): void {
    this.clear();
    this.#listeners.clear();
  }

  begin(params: DynamicToolCallParams, call: BrowserToolCall): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    const previous = this.#sessions.get(id);
    const detailAction = browserControlDetailAction(params.tool);
    this.#sessions.set(id, {
      id,
      threadId: params.threadId,
      turnId: params.turnId,
      callId: params.callId,
      tabId: "tabId" in call.args ? call.args.tabId : null,
      action: browserControlAction(call),
      ...(detailAction === undefined ? {} : { detailAction }),
      phase: "acting",
      startedAt: previous?.startedAt ?? new Date().toISOString(),
    });
    this.#emitChanged();
  }

  finish(params: DynamicToolCallParams): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const current = this.#sessions.get(id);
    if (!current || current.callId !== params.callId) return;
    this.#sessions.set(id, { ...current, phase: "waiting" });
    this.#emitChanged();
    const timer = setTimeout(() => {
      this.#timers.delete(id);
      const latest = this.#sessions.get(id);
      if (!latest || latest.callId !== params.callId || latest.phase !== "waiting") return;
      this.#sessions.delete(id);
      this.#emitChanged();
    }, BrowserControlSessions.IDLE_GRACE_MS);
    timer.unref();
    this.#timers.set(id, timer);
  }

  updateTab(params: DynamicToolCallParams, tabId: string): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const current = this.#sessions.get(id);
    if (!current || current.callId !== params.callId) return;
    this.#sessions.set(id, { ...current, tabId });
    this.#emitChanged();
  }

  #emitChanged(): void {
    const state = this.state();
    for (const listener of this.#listeners) listener(state);
  }
}
