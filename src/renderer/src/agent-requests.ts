import { z } from "zod";

const REQUESTS_KEY = "openbot:agent-requests";
const REQUEST_WINDOW_MS = 30 * 60_000;

const requestKey = (serverId: string, agentId: string) => `${serverId}\n${agentId}`;

const requestsSchema = z.record(z.string(), z.number());

function readRequests(now: number): Map<string, number> {
  const requests = new Map<string, number>();
  try {
    const stored = requestsSchema.parse(JSON.parse(window.localStorage.getItem(REQUESTS_KEY) ?? "{}"));
    for (const [key, sentAt] of Object.entries(stored)) {
      if (now - sentAt < REQUEST_WINDOW_MS) requests.set(key, sentAt);
    }
  } catch {}
  return requests;
}

export function noteAgentRequest(serverId: string, agentId: string): void {
  const now = Date.now();
  const requests = readRequests(now);
  requests.set(requestKey(serverId, agentId), now);
  try {
    window.localStorage.setItem(REQUESTS_KEY, JSON.stringify(Object.fromEntries(requests)));
  } catch {}
}

export function agentAskedHere(serverId: string, agentId: string): boolean {
  return readRequests(Date.now()).has(requestKey(serverId, agentId));
}
