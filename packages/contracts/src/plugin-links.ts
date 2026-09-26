/**
 * The two addresses one plugin listing has: the page a person shares, and the link that opens that
 * listing in the app.
 *
 * ```
 * https://openbot.run/plugins/<slug>    the link a person shares and the app copies
 * openbot://plugins/<slug>              the link the page button opens
 * ```
 *
 * The host gives the kind and the path gives the argument, which is the rule `parseInviteUrl`
 * already follows with `hostname === "join"`. An invite needs four fields and so needs a query; a
 * plugin needs one identifier, so a path segment is enough. Refusing a query outright is what stops
 * the shape growing an `?install=1` later.
 *
 * Both forms are *built* from a slug and never read out of catalog data. A listing therefore cannot
 * put a foreign address behind the button that says it copies its own link.
 *
 * `invite-links.ts` is untouched by this: it owns `join`, and the router asks it first, so no invite
 * rule becomes weaker.
 */

export const OPENBOT_PLUGIN_ORIGIN = "https://openbot.run";
export const OPENBOT_PLUGIN_PATH_PREFIX = "/plugins/";
export const OPENBOT_PLUGIN_HOST = "plugins";

/**
 * A slug cannot hold a dot, an upper-case letter or a slash. The dot is the load-bearing one: it is
 * what stops a slug reaching `catalog.json` when the static catalog routes land beside these pages.
 */
const PLUGIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

export function isPluginSlug(value: string): boolean {
  return PLUGIN_SLUG_PATTERN.test(value);
}

/** Where a shared plugin link points. */
export function createPluginShareUrl(slug: string): string {
  assertPluginSlug(slug);
  return `${OPENBOT_PLUGIN_ORIGIN}${OPENBOT_PLUGIN_PATH_PREFIX}${slug}`;
}

/** The link the page's button opens, which raises the app on this listing. */
export function createOpenBotPluginUrl(slug: string): string {
  assertPluginSlug(slug);
  return `openbot://${OPENBOT_PLUGIN_HOST}/${slug}`;
}

/**
 * What a listing's link row shows: the address without the scheme and the `www.` a reader does not
 * need. The path stays, because a listing's three links usually differ only there. The app and the
 * public plugin page both use it, so the two read alike.
 */
export function pluginLinkText(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host.replace(/^www\./, "")}${pathname === "/" ? "" : pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * The slug a plugin link names, in either form. Throws for anything else, so a caller that wants a
 * decision rather than a value uses `isPluginUrl`.
 */
export function parsePluginUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The OpenBot plugin link is invalid.");
  }

  /* The origin is compared as one string. An `endsWith` or a host expression here is what lets
     `openbot.run.example.com` through. */
  const canonical =
    url.protocol === "https:" &&
    url.origin === OPENBOT_PLUGIN_ORIGIN &&
    url.pathname.startsWith(OPENBOT_PLUGIN_PATH_PREFIX);
  const customScheme = url.protocol === "openbot:" && url.hostname === OPENBOT_PLUGIN_HOST;
  if (
    (!canonical && !customScheme) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("The OpenBot plugin link is invalid.");
  }

  /* One segment after the prefix, and no empty one. `..` and a trailing slash both fail here before
     the pattern ever sees them. */
  const rest = canonical ? url.pathname.slice(OPENBOT_PLUGIN_PATH_PREFIX.length) : url.pathname.replace(/^\//u, "");
  const segments = rest.split("/");
  if (segments.length !== 1) {
    throw new Error("The OpenBot plugin link is invalid.");
  }

  const slug = segments[0] ?? "";
  assertPluginSlug(slug);
  return slug;
}

export function isPluginUrl(value: string): boolean {
  try {
    parsePluginUrl(value);
    return true;
  } catch {
    return false;
  }
}

function assertPluginSlug(slug: string): void {
  if (!isPluginSlug(slug)) {
    throw new Error("The OpenBot plugin link is invalid.");
  }
}
