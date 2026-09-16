import type { WatcherSource } from "@openbot/contracts/ipc";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { looksLikeAppShell, normalizeWatcherText } from "./watcher-content";

const logger = createOpenBotLogger("watcher-sources");

/** How the bytes arrived. Stored per check, so health shows fetch versus browser. */
export type WatcherCheckMode = "fetch" | "browser" | "gmail";

/** One normalized fact set from a source poll. Small on purpose: never a full inbox or page. */
export interface WatcherFacts {
  sourceId: string;
  text: string;
  summary: string;
  mode: WatcherCheckMode;
  /** Raw HTML carried shell markers: the text read is the loader, not the page. */
  shell: boolean;
}

export interface WatcherSourceDeps {
  fetchHtml?: (url: string) => Promise<string>;
  listGmail?: (query: string, labelIds?: string[]) => Promise<WatcherFacts[]>;
  readPageText?: (url: string, selectorCss?: string) => Promise<string | null>;
}

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 2_000_000;
const FETCH_CONTENT_PATTERN = /text|html|xml|json|rss|atom/i;

function defaultFetchHtml(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Watcher URLs must use https.");
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) {
    throw new Error("Watcher URLs must be public.");
  }
  return fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then(async (response) => {
    if (!response.ok) throw new Error(`Page fetch failed with status ${response.status}.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !FETCH_CONTENT_PATTERN.test(contentType)) {
      throw new Error("Page content type is not readable text.");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > FETCH_MAX_BYTES) {
      throw new Error("Page is too large to watch.");
    }
    const text = await response.text();
    return text.slice(0, 500_000);
  });
}

/**
 * Owns source polling without LLM and without database. Each reader returns small facts only.
 * Gmail returns one fact per new message. Web returns one fact per page.
 */
export async function readWatcherSource(source: WatcherSource, deps: WatcherSourceDeps = {}): Promise<WatcherFacts[]> {
  if (source.kind === "gmail") {
    if (!deps.listGmail) return [];
    try {
      const facts = (await deps.listGmail(source.query, source.labelIds)).slice(0, 10);
      return facts.map((fact) => ({ ...fact, mode: fact.mode ?? "gmail", shell: fact.shell ?? false }));
    } catch (error) {
      logger.warn(`Gmail watcher poll failed: ${redactText(String(error))}`);
      throw error;
    }
  }
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  try {
    if (deps.readPageText) {
      const rendered = await deps.readPageText(source.url);
      if (rendered !== null) {
        const normalized = normalizeWatcherText(rendered);
        return [
          {
            sourceId: normalized.slice(0, 128),
            text: normalized,
            summary: `Page text: ${source.url}`,
            mode: "browser",
            shell: false,
          },
        ];
      }
    }
    const html = await fetchHtml(source.url);
    const normalized = normalizeWatcherText(html);
    return [
      {
        sourceId: normalized.slice(0, 128),
        text: normalized,
        summary: `Page text: ${source.url}`,
        mode: "fetch",
        shell: looksLikeAppShell(html),
      },
    ];
  } catch (error) {
    logger.warn("Web watcher poll failed.");
    throw error;
  }
}
