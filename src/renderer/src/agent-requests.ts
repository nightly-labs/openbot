/**
 * The agents that a person sent a message to from this device, and when. A workflow that an agent
 * makes opens on the Workflows page only when the person asked that agent here: a request from a
 * phone or another computer must not change the workflow that this device shows (#11072).
 *
 * The record is in `localStorage`, so each window of this device sees the messages of the others,
 * such as a separate chat window. Reading `window.localStorage` throws when the browser blocks
 * storage, so each read and write is in a guard.
 */
import { z } from "zod";

const REQUESTS_KEY = "openbot:agent-requests";
/** How long a message counts as the request: an agent can build a workflow over a long turn. */
const REQUEST_WINDOW_MS = 30 * 60_000;

const requestKey = (serverId: string, agentId: string) => `${serverId}\n${agentId}`;

const requestsSchema = z.record(z.string(), z.number());

/** The send time of each request that still counts. A damaged value reads as none. */
function readRequests(now: number): Map<string, number> {
  const requests = new Map<string, number>();
  try {
    const stored = requestsSchema.parse(JSON.parse(window.localStorage.getItem(REQUESTS_KEY) ?? "{}"));
    for (const [key, sentAt] of Object.entries(stored)) {
      if (now - sentAt < REQUEST_WINDOW_MS) requests.set(key, sentAt);
    }
  } catch {
    // No record: no new workflow of an agent opens by itself.
  }
  return requests;
}

/** Records that a person on this device sent a message to `agentId` on `serverId`. */
export function noteAgentRequest(serverId: string, agentId: string): void {
  const now = Date.now();
  const requests = readRequests(now);
  requests.set(requestKey(serverId, agentId), now);
  try {
    window.localStorage.setItem(REQUESTS_KEY, JSON.stringify(Object.fromEntries(requests)));
  } catch {
    // The new workflow of the agent then goes only into the library.
  }
}

/** Whether a person on this device sent a message to `agentId` on `serverId` a short time ago. */
export function agentAskedHere(serverId: string, agentId: string): boolean {
  return readRequests(Date.now()).has(requestKey(serverId, agentId));
}
