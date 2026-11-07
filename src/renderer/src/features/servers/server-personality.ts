import type { HostPersonality, OpenBotDesktopApi, ResponseStyle } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";

/** The personality calls of one server's host. The desktop reaches them through main. */
export type HostPersonalityCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getPersonality" | "setPersonality">;

/** The last known response style of each server, by server id. One copy for the page. */
const [styles, setStyles] = createSignal<ReadonlyMap<string, ResponseStyle>>(new Map());
/** The servers with a read in progress, so two chats of one server read it once. */
const reading = new Set<string>();

/**
 * The response style of a server, or undefined until its host answered. The chat shows progress
 * updates only for a "natural" server.
 */
export function serverResponseStyle(serverId: string): ResponseStyle | undefined {
  return styles().get(serverId);
}

/** Keeps what a host returned, so open chats follow a change made in Server settings at once. */
export function rememberServerPersonality(serverId: string, personality: HostPersonality): void {
  if (styles().get(serverId) === personality.responseStyle) return;
  setStyles((current) => new Map(current).set(serverId, personality.responseStyle));
}

/**
 * Reads the style of a server again. The caller reads each time a server opens, so a change from
 * another device shows then. The last known style stays until the host answers, and a
 * failed read keeps it.
 */
export function loadServerPersonality(serverId: string, calls: HostPersonalityCalls): void {
  if (reading.has(serverId)) return;
  reading.add(serverId);
  calls.getPersonality(serverId).then(
    (personality) => {
      reading.delete(serverId);
      rememberServerPersonality(serverId, personality);
    },
    () => {
      reading.delete(serverId);
    },
  );
}
