export const OPENBOT_AGENT_TEMPLATE_ORIGIN = "https://openbot.run";
export const OPENBOT_AGENT_TEMPLATE_PATH_PREFIX = "/agents/";
export const OPENBOT_AGENT_TEMPLATE_HOST = "agents";
export const WEB_APP_AGENT_TEMPLATE_PARAM = "agent";

const AGENT_TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

export function isAgentTemplateId(value: string): boolean {
  return AGENT_TEMPLATE_ID_PATTERN.test(value);
}

export function isAgentTemplateShareOrigin(origin: string): boolean {
  if (origin === OPENBOT_AGENT_TEMPLATE_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

export function agentTemplateShareOrigin(apiOrigin: string): string {
  return apiOrigin !== OPENBOT_AGENT_TEMPLATE_ORIGIN && isAgentTemplateShareOrigin(apiOrigin)
    ? apiOrigin
    : OPENBOT_AGENT_TEMPLATE_ORIGIN;
}

export function createAgentTemplateShareUrl(id: string, origin: string = OPENBOT_AGENT_TEMPLATE_ORIGIN): string {
  assertAgentTemplateId(id);
  if (!isAgentTemplateShareOrigin(origin)) throw new Error("The OpenBot agent link origin is invalid.");
  return `${origin}${OPENBOT_AGENT_TEMPLATE_PATH_PREFIX}${id}`;
}

export function createWebAppAgentTemplatePath(id: string): string {
  assertAgentTemplateId(id);
  return `/app?${WEB_APP_AGENT_TEMPLATE_PARAM}=${id}`;
}

export function agentTemplateIdFromWebAppSearch(search: string): string | null {
  const id = new URLSearchParams(search).get(WEB_APP_AGENT_TEMPLATE_PARAM);
  return id !== null && isAgentTemplateId(id) ? id : null;
}

export function createOpenBotAgentTemplateUrl(id: string): string {
  assertAgentTemplateId(id);
  return `openbot://${OPENBOT_AGENT_TEMPLATE_HOST}/${id}`;
}

export function parseAgentTemplateUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The OpenBot agent link is invalid.");
  }

  const canonical =
    url.protocol === "https:" &&
    url.origin === OPENBOT_AGENT_TEMPLATE_ORIGIN &&
    url.pathname.startsWith(OPENBOT_AGENT_TEMPLATE_PATH_PREFIX);
  const customScheme = url.protocol === "openbot:" && url.hostname === OPENBOT_AGENT_TEMPLATE_HOST;
  if (
    (!canonical && !customScheme) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("The OpenBot agent link is invalid.");
  }

  const rest = canonical
    ? url.pathname.slice(OPENBOT_AGENT_TEMPLATE_PATH_PREFIX.length)
    : url.pathname.replace(/^\//u, "");
  const segments = rest.split("/");
  if (segments.length !== 1) throw new Error("The OpenBot agent link is invalid.");
  const id = segments[0] ?? "";
  assertAgentTemplateId(id);
  return id;
}

function assertAgentTemplateId(id: string): void {
  if (!isAgentTemplateId(id)) throw new Error("The OpenBot agent link is invalid.");
}
