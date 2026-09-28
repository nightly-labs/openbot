// The display model of the "What's new" dialog. The notes come from the release notes in
// CHANGELOG.md, which are already written for people, so an entry is never a commit title. Each
// entry is plain text: the loader removes the Markdown of the file, such as `**bold**` and code.

export type WhatsNewGroupType = "added" | "changed" | "fixed";

export interface WhatsNewGroup {
  type: WhatsNewGroupType;
  items: readonly string[];
}

export interface WhatsNewRelease {
  version: string;
  /** `YYYY-MM-DD`, as the changelog heading writes it. */
  date: string;
  /** Steps the reader must do after the update. */
  notices: readonly string[];
  groups: readonly WhatsNewGroup[];
}

export type WhatsNewNotes =
  | { status: "loading" }
  | { status: "failed" }
  /** Newest first. More than one release when the update skipped versions. */
  | { status: "ready"; releases: readonly WhatsNewRelease[] };

export interface WhatsNewSummary {
  notices: string[];
  groups: WhatsNewGroup[];
}

const GROUP_ORDER: readonly WhatsNewGroupType[] = ["added", "changed", "fixed"];

/**
 * One list for each group across all releases, newest first. A reader who skipped versions wants
 * to know what they can do now, not in which version each change came.
 */
export function summarizeWhatsNew(releases: readonly WhatsNewRelease[]): WhatsNewSummary {
  const notices = releases.flatMap((release) => release.notices);
  const groups = GROUP_ORDER.map((type) => ({
    type,
    items: releases
      .flatMap((release) => release.groups.filter((group) => group.type === type))
      .flatMap((group) => group.items),
  })).filter((group) => group.items.length > 0);
  return { notices, groups };
}

export interface WhatsNewEntry {
  headline: string;
  /** The sentences after the first. Empty when the entry is one sentence. */
  detail: string;
}

/**
 * A sentence ends at `.`, `!` or `?`, and an optional closing quote, before a space and a capital
 * letter or a quote. The notes use no abbreviations such as "e.g.", so a period ends a sentence.
 */
const FIRST_SENTENCE = /^(.+?[.!?]["”]?)\s+(?=[A-Z"“])(.+)$/su;

/**
 * The changelog writes what changed in the first sentence and why or how in the next ones. The
 * dialog shows the first sentence as the headline, so a reader can scan the list.
 */
export function whatsNewEntry(text: string): WhatsNewEntry {
  const match = FIRST_SENTENCE.exec(text.trim());
  if (!match?.[1] || !match[2]) return { headline: text.trim(), detail: "" };
  return { headline: match[1], detail: match[2] };
}
