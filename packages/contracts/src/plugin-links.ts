export const OPENBOT_PLUGIN_ORIGIN = "https://openbot.run";
export const OPENBOT_PLUGIN_PATH_PREFIX = "/plugins/";
export const OPENBOT_PLUGIN_HOST = "plugins";
export const WEB_APP_PLUGIN_PARAM = "plugin";

const PLUGIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

export function isPluginSlug(value: string): boolean {
  return PLUGIN_SLUG_PATTERN.test(value);
}

export function createPluginShareUrl(slug: string): string {
  assertPluginSlug(slug);
  return `${OPENBOT_PLUGIN_ORIGIN}${OPENBOT_PLUGIN_PATH_PREFIX}${slug}`;
}

export function createWebAppPluginPath(slug: string): string {
  assertPluginSlug(slug);
  return `/app?${WEB_APP_PLUGIN_PARAM}=${slug}`;
}

export function pluginSlugFromWebAppSearch(search: string): string | null {
  const slug = new URLSearchParams(search).get(WEB_APP_PLUGIN_PARAM);
  return slug !== null && isPluginSlug(slug) ? slug : null;
}

export function createOpenBotPluginUrl(slug: string): string {
  assertPluginSlug(slug);
  return `openbot://${OPENBOT_PLUGIN_HOST}/${slug}`;
}

export function pluginLinkText(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host.replace(/^www\./, "")}${pathname === "/" ? "" : pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

export function parsePluginUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The OpenBot plugin link is invalid.");
  }

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
