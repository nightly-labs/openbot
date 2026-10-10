import { z } from "zod";
import { releaseVersion } from "./whats-new-history";
import notesUrl from "./whats-new-releases.json?url&no-inline";

const releaseSchema = z.object({
  version: z.string().refine((value) => releaseVersion(value) !== null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notices: z.array(z.string()),
  groups: z.array(z.object({ type: z.enum(["added", "changed", "fixed"]), items: z.array(z.string()) })),
});

/** Decode the bundled editorial data at its read boundary. Never load commits or remote fallback text. */
export const whatsNewReleasesSchema = z.array(releaseSchema);

/** Each retry reads the asset again. The URL points into the installed app, not a remote service. */
export async function loadWhatsNewReleases(signal: AbortSignal) {
  const response = await fetch(notesUrl, { signal });
  if (!response.ok) throw new Error("Release notes are unavailable.");
  return whatsNewReleasesSchema.parse(await response.json());
}
