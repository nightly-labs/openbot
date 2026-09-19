/**
 * What an `openbot://` or `https://openbot.run/...` link means.
 *
 * The scheme carries more than one kind of link now, so the decision of which kind a URL is has one
 * home rather than one `try` per entry point. `src/main/index.ts` has four ways a link arrives -
 * `open-url`, `continue-activity`, a second instance's argv, and this process's own argv - and each
 * of them asks this module and then acts on the answer.
 *
 * The invite parser runs first. It owns the host `join`, it is the shipped behaviour, and asking it
 * first is what stops a later kind ever claiming one of its links.
 *
 * Anything this module does not recognise is `null`, which every caller drops without a message.
 * That is the existing behaviour for junk in argv, and it is what keeps an older build safe in
 * front of a link kind it has never heard of.
 */

import { type InviteLinkOptions, parseInviteUrl } from "@openbot/contracts/invite-links";
import { parsePluginUrl } from "@openbot/contracts/plugin-links";

export type DeepLink = { kind: "invite"; url: string } | { kind: "plugin"; slug: string };

export function parseDeepLink(value: string, options: InviteLinkOptions = {}): DeepLink | null {
  try {
    parseInviteUrl(value, options);
    return { kind: "invite", url: value };
  } catch {
    // Not an invitation. Most command-line arguments are not a link of any kind.
  }

  try {
    return { kind: "plugin", slug: parsePluginUrl(value) };
  } catch {
    return null;
  }
}

/** The first argument that is a link. Used for a cold start and for a second instance's argv. */
export function findDeepLink(values: string[], options: InviteLinkOptions = {}): DeepLink | null {
  for (const value of values) {
    const link = parseDeepLink(value, options);
    if (link) return link;
  }
  return null;
}
