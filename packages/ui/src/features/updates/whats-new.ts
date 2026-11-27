export type WhatsNewGroupType = "added" | "changed" | "fixed";

export interface WhatsNewGroup {
  type: WhatsNewGroupType;
  items: readonly string[];
}

export interface WhatsNewRelease {
  version: string;
  date: string;
  notices: readonly string[];
  groups: readonly WhatsNewGroup[];
}

export type WhatsNewNotes =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; releases: readonly WhatsNewRelease[] };

export interface WhatsNewSummary {
  notices: string[];
  groups: WhatsNewGroup[];
}

const GROUP_ORDER: readonly WhatsNewGroupType[] = ["added", "changed", "fixed"];

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
  detail: string;
}

const FIRST_SENTENCE = /^(.+?(?:[.!?؟]["“”»]?(?=\s+["“„«¿¡]?[\p{Lu}\p{Lo}])|[。！？][”」』]?(?=\s*\S)))\s*(.+)$/su;

export function whatsNewEntry(text: string): WhatsNewEntry {
  const match = FIRST_SENTENCE.exec(text.trim());
  if (!match?.[1] || !match[2]) return { headline: text.trim(), detail: "" };
  return { headline: match[1], detail: match[2] };
}
