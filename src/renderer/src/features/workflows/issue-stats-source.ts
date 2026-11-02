import { createSignal, onSettled } from "solid-js";
import { type IssueStats, isIssueStats } from "./WorkflowIssueStats";

/**
 * The issue-stats helper (`scripts/issue-stats.cjs` of the OpenBot checkout). It asks GitHub every
 * few minutes and keeps the answer; this page only reads that answer. The development CSP allows
 * `http://localhost:*`, so there is no IPC channel and no main-process code for it.
 */
const ISSUE_STATS_URL = "http://localhost:4178/issue-stats";
/** The helper answers from memory, so reading every minute is cheap and shows its refresh soon after it ran. */
const POLL_MS = 60_000;
const TIMEOUT_MS = 10_000;

/** Reads the issue numbers while the page shows. A failed read keeps the last numbers and sets `error`. */
export function createIssueStats(project?: (() => string | null) | undefined) {
  const [stats, setStats] = createSignal<IssueStats | undefined>();
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  let disposed = false;

  const read = async () => {
    const repo = project?.() ?? null;
    const url = repo ? `${ISSUE_STATS_URL}?repo=${encodeURIComponent(repo)}` : ISSUE_STATS_URL;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: abort.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`The issue-stats helper answered ${response.status}`);
      const body = await response.json();
      if (!isIssueStats(body)) throw new Error("The issue-stats helper sent an answer this page cannot read");
      if (!disposed) {
        setStats(body);
        setError(null);
      }
    } catch (failure) {
      if (!disposed) setError(failure instanceof Error ? failure.message : "The issue-stats helper did not answer");
    } finally {
      clearTimeout(timer);
      if (!disposed) setLoading(false);
    }
  };

  onSettled(() => {
    void read();
    const interval = setInterval(() => {
      if (!document.hidden) void read();
    }, POLL_MS);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  });

  return { stats, error, loading };
}
