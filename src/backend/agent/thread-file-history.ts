import { isAbsolute } from "node:path";

/** Owns local, in-memory tool paths. These paths never enter conversation events or storage. */
export class ThreadFileHistory {
  readonly #threads = new Map<string, { agentId: string; paths: string[] }>();

  record(agentId: string, threadId: string, paths: unknown): void {
    if (!Array.isArray(paths)) return;
    const history = this.#threads.get(threadId) ?? { agentId, paths: [] };
    for (const path of paths) {
      if (typeof path !== "string" || !isAbsolute(path)) continue;
      const previous = history.paths.indexOf(path);
      if (previous !== -1) history.paths.splice(previous, 1);
      history.paths.push(path);
      if (history.paths.length > 200) history.paths.shift();
    }
    if (history.paths.length > 0) this.#threads.set(threadId, history);
  }

  paths(agentId: string, threadId: string | null): readonly string[] {
    const history = threadId ? this.#threads.get(threadId) : undefined;
    return history?.agentId === agentId ? history.paths : [];
  }

  forgetAgent(agentId: string): void {
    for (const [threadId, history] of this.#threads) {
      if (history.agentId === agentId) this.#threads.delete(threadId);
    }
  }

  clear(): void {
    this.#threads.clear();
  }
}
