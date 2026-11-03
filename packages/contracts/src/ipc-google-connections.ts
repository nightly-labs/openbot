import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export interface GoogleConnectionSummary {
  id: string;
  email: string | null;
  connected: boolean;
  signingIn: boolean;
  agentId: string | null;
  agentName: string | null;
  eligibleAgentIds: string[];
  error: string | null;
}
export interface GoogleConnectionsSnapshot {
  configured: boolean;
  canConfigure: boolean;
  profiles: GoogleConnectionSummary[];
  eligibleAgents: { id: string; name: string }[];
  templates: { id: string; name: string }[];
}
export interface GoogleConnectionProfileInput {
  profileId: string | null;
}
export interface GoogleConnectionAssignInput {
  profileId: string;
  agentId: string;
}
export interface GoogleConnectionConfigureInput {
  mcpServerId: string;
}

const id = (v: unknown): v is string => isIdentifier(v) && v.trim() === v;
const text = (v: unknown, limit: number): v is string => typeof v === "string" && v.length <= limit;
const nilText = (v: unknown, limit: number): v is string | null => v === null || text(v, limit);
export function parseGoogleConnectionProfile(value: unknown): GoogleConnectionProfileInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((k) => k !== "profileId") ||
    !(value.profileId === null || id(value.profileId))
  )
    throw new Error("Invalid Google connection profile.");
  return { profileId: value.profileId };
}
export function parseGoogleConnectionAssign(value: unknown): GoogleConnectionAssignInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((k) => !["profileId", "agentId"].includes(k)) ||
    !id(value.profileId) ||
    !id(value.agentId)
  )
    throw new Error("Invalid Google agent assignment.");
  return { profileId: value.profileId, agentId: value.agentId };
}
export function parseGoogleConnectionConfigure(value: unknown): GoogleConnectionConfigureInput {
  if (!isDynamicRecord(value) || Object.keys(value).some((k) => k !== "mcpServerId") || !id(value.mcpServerId))
    throw new Error("Invalid Google connection setup.");
  return { mcpServerId: value.mcpServerId };
}
export function parseGoogleConnectionsSnapshot(value: unknown): GoogleConnectionsSnapshot {
  const named = (v: unknown): v is { id: string; name: string } => isDynamicRecord(v) && id(v.id) && text(v.name, 1024);
  if (
    !isDynamicRecord(value) ||
    typeof value.configured !== "boolean" ||
    typeof value.canConfigure !== "boolean" ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 100 ||
    !Array.isArray(value.eligibleAgents) ||
    value.eligibleAgents.length > 1000 ||
    !value.eligibleAgents.every(named) ||
    !Array.isArray(value.templates) ||
    value.templates.length > 1000 ||
    !value.templates.every(named)
  )
    throw new Error("Invalid Google connections response.");
  const profiles: GoogleConnectionSummary[] = value.profiles.map((p) => {
    if (
      !isDynamicRecord(p) ||
      !id(p.id) ||
      !nilText(p.email, 320) ||
      typeof p.connected !== "boolean" ||
      typeof p.signingIn !== "boolean" ||
      !(p.agentId === null || id(p.agentId)) ||
      !nilText(p.agentName, 1024) ||
      !Array.isArray(p.eligibleAgentIds) ||
      p.eligibleAgentIds.length > 1000 ||
      !p.eligibleAgentIds.every(id) ||
      !nilText(p.error, 2000)
    )
      throw new Error("Invalid Google connection response.");
    return {
      id: p.id,
      email: p.email,
      connected: p.connected,
      signingIn: p.signingIn,
      agentId: p.agentId,
      agentName: p.agentName,
      eligibleAgentIds: [...p.eligibleAgentIds],
      error: p.error,
    };
  });
  return {
    configured: value.configured,
    canConfigure: value.canConfigure,
    profiles,
    eligibleAgents: value.eligibleAgents.map(({ id, name }) => ({ id, name })),
    templates: value.templates.map(({ id, name }) => ({ id, name })),
  };
}

export function parseGoogleConnectionFlow(value: unknown): { flowId: string; query?: string } {
  if (
    !isDynamicRecord(value) ||
    !id(value.flowId) ||
    Object.keys(value).some((k) => k !== "flowId" && k !== "query") ||
    (value.query !== undefined && !text(value.query, 8192))
  )
    throw new Error("Invalid Google sign-in flow.");
  return { flowId: value.flowId, ...(value.query === undefined ? {} : { query: value.query }) };
}

/** The Google action can auto-open only this bounded consent page and its loopback callback. */
export function isGoogleConnectionPage(value: string): boolean {
  try {
    if (value.length > 8192) return false;
    const page = new URL(value),
      callback = new URL(page.searchParams.get("redirect_uri") ?? "");
    const scopes = new Set((page.searchParams.get("scope") ?? "").split(" "));
    const required = ["gmail.readonly", "gmail.send", "calendar.calendarlist.readonly", "calendar.events"].map(
      (s) => `https://www.googleapis.com/auth/${s}`,
    );
    return (
      page.origin === "https://accounts.google.com" &&
      page.pathname === "/o/oauth2/v2/auth" &&
      !page.username &&
      !page.password &&
      !page.hash &&
      !!page.searchParams.get("client_id") &&
      page.searchParams.get("response_type") === "code" &&
      page.searchParams.get("code_challenge_method") === "S256" &&
      /^[A-Za-z0-9_-]{43}$/u.test(page.searchParams.get("code_challenge") ?? "") &&
      /^[A-Za-z0-9_-]{32,256}$/u.test(page.searchParams.get("state") ?? "") &&
      scopes.size === required.length &&
      required.every((s) => scopes.has(s)) &&
      callback.protocol === "http:" &&
      callback.hostname === "127.0.0.1" &&
      !!callback.port &&
      callback.pathname === "/oauth/callback" &&
      !callback.username &&
      !callback.password &&
      !callback.search &&
      !callback.hash
    );
  } catch {
    return false;
  }
}
