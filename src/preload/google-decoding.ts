import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { GoogleConnectionsSnapshot } from "@openbot/contracts/ipc";
import { decodeRecord, requiredBoolean } from "@openbot/contracts/ipc-decoding";
/** The renderer boundary is independent of the remote host decoder. No credential fields survive. */
export function decodeGoogleConnectionsFromMain(value: unknown): GoogleConnectionsSnapshot {
  const r = decodeRecord(value, "Google connections");
  const string = (v: unknown, max: number): string => {
    if (typeof v !== "string" || v.length > max) throw new Error("Invalid Google connection text.");
    return v;
  };
  const id = (v: unknown): string => {
    if (typeof v !== "string" || !v || v.length > INPUT_LIMITS.identifier || v.trim() !== v)
      throw new Error("Invalid Google connection ID.");
    return v;
  };
  const nullable = (v: unknown, max: number) => (v === null ? null : string(v, max));
  const named = (v: unknown) => {
    const p = decodeRecord(v, "Google connection agent");
    return { id: id(p.id), name: string(p.name, 1024) };
  };
  if (
    !Array.isArray(r.profiles) ||
    r.profiles.length > 100 ||
    !Array.isArray(r.eligibleAgents) ||
    r.eligibleAgents.length > 1000 ||
    !Array.isArray(r.templates) ||
    r.templates.length > 1000
  )
    throw new Error("Invalid Google connection lists.");
  return {
    configured: requiredBoolean(r, "configured"),
    canConfigure: requiredBoolean(r, "canConfigure"),
    profiles: r.profiles.map((v) => {
      const p = decodeRecord(v, "Google connection");
      if (!Array.isArray(p.eligibleAgentIds) || p.eligibleAgentIds.length > 1000)
        throw new Error("Invalid Google eligible agents.");
      return {
        eligibleAgentIds: p.eligibleAgentIds.map(id),
        id: id(p.id),
        email: nullable(p.email, 320),
        connected: requiredBoolean(p, "connected"),
        signingIn: requiredBoolean(p, "signingIn"),
        agentId: p.agentId === null ? null : id(p.agentId),
        agentName: nullable(p.agentName, 1024),
        error: nullable(p.error, 2000),
      };
    }),
    eligibleAgents: r.eligibleAgents.map(named),
    templates: r.templates.map(named),
  };
}
