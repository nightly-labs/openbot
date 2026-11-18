import type { TranslatedLocale } from "@openbot/i18n";
import type { WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";
import { z } from "zod";
import arUrl from "./whats-new/ar.json?url&no-inline";
import deUrl from "./whats-new/de.json?url&no-inline";
import esUrl from "./whats-new/es.json?url&no-inline";
import frUrl from "./whats-new/fr.json?url&no-inline";
import heUrl from "./whats-new/he.json?url&no-inline";
import itUrl from "./whats-new/it.json?url&no-inline";
import jaUrl from "./whats-new/ja.json?url&no-inline";
import koUrl from "./whats-new/ko.json?url&no-inline";
import nlUrl from "./whats-new/nl.json?url&no-inline";
import plUrl from "./whats-new/pl.json?url&no-inline";
import ptUrl from "./whats-new/pt.json?url&no-inline";
import ruUrl from "./whats-new/ru.json?url&no-inline";
import trUrl from "./whats-new/tr.json?url&no-inline";
import zhUrl from "./whats-new/zh.json?url&no-inline";
import { releaseVersion } from "./whats-new-history";
import notesUrl from "./whats-new-releases.json?url&no-inline";

/**
 * The translated notes of each language. A file holds only the releases that were translated, in
 * the shape of the English file. The record names every translated locale, so a new language does
 * not build until it has a file.
 */
const TRANSLATED_NOTES_URLS: Record<Exclude<TranslatedLocale, "en">, string> = {
  ar: arUrl,
  de: deUrl,
  es: esUrl,
  fr: frUrl,
  he: heUrl,
  it: itUrl,
  ja: jaUrl,
  ko: koUrl,
  nl: nlUrl,
  pl: plUrl,
  pt: ptUrl,
  ru: ruUrl,
  tr: trUrl,
  zh: zhUrl,
};

const releaseSchema = z.object({
  version: z.string().refine((value) => releaseVersion(value) !== null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notices: z.array(z.string()),
  groups: z.array(z.object({ type: z.enum(["added", "changed", "fixed"]), items: z.array(z.string()) })),
});

/** Decode the bundled editorial data at its read boundary. Never load commits or remote fallback text. */
const whatsNewReleasesSchema = z.array(releaseSchema);

async function loadNotes(url: string, signal: AbortSignal): Promise<WhatsNewRelease[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Release notes are unavailable.");
  return whatsNewReleasesSchema.parse(await response.json());
}

/**
 * The release notes in `locale`. A release with no translation keeps its English text, so an old
 * release or a missing file never removes notes. Each retry reads the assets again. The URLs point
 * into the installed app, not a remote service.
 */
export async function loadWhatsNewReleases(signal: AbortSignal, locale: TranslatedLocale): Promise<WhatsNewRelease[]> {
  if (locale === "en") return loadNotes(notesUrl, signal);
  const [english, translated] = await Promise.all([
    loadNotes(notesUrl, signal),
    loadNotes(TRANSLATED_NOTES_URLS[locale], signal).catch(() => []),
  ]);
  const byVersion = new Map(translated.map((release) => [release.version, release]));
  return english.map((release) => byVersion.get(release.version) ?? release);
}
