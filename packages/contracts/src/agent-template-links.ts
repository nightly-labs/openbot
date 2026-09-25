/**
 * The two addresses one agent template has: the page a person shares, and the link that opens that
 * template in the app.
 *
 * ```
 * https://openbot.run/agents/<id>    the link a person shares and the app copies
 * openbot://agents/<id>              the link the page button opens
 * ```
 *
 * This follows `plugin-links.ts`: the host gives the kind, one path segment gives the id, and a
 * query is refused, so the shape cannot grow an `?install=1`. A link opens a preview in the app;
 * installing is still a press of Install there.
 */

export const OPENBOT_AGENT_TEMPLATE_ORIGIN = "https://openbot.run";
export const OPENBOT_AGENT_TEMPLATE_PATH_PREFIX = "/agents/";
export const OPENBOT_AGENT_TEMPLATE_HOST = "agents";

/** The Worker makes ids from 16 random bytes in base64url, which is 22 characters. */
const AGENT_TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

export function isAgentTemplateId(value: string): boolean {
  return AGENT_TEMPLATE_ID_PATTERN.test(value);
}

export function createAgentTemplateShareUrl(id: string): string {
  assertAgentTemplateId(id);
  return `${OPENBOT_AGENT_TEMPLATE_ORIGIN}${OPENBOT_AGENT_TEMPLATE_PATH_PREFIX}${id}`;
}

export function createOpenBotAgentTemplateUrl(id: string): string {
  assertAgentTemplateId(id);
  return `openbot://${OPENBOT_AGENT_TEMPLATE_HOST}/${id}`;
}

/** The template id a link names, in either form. Throws for anything else. */
export function parseAgentTemplateUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The OpenBot agent link is invalid.");
  }

  // The origin is compared as one string, so `openbot.run.example.com` does not pass.
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
