import type { HostPersonality, OpenBotDesktopApi, ResponseStyle, ServerSummary } from "@openbot/contracts/ipc";
import { createEffect, createSignal } from "solid-js";

export type HostPersonalityCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getPersonality" | "setPersonality">;

const [styles, setStyles] = createSignal<ReadonlyMap<string, ResponseStyle>>(new Map());
const reading = new Set<string>();

export function serverResponseStyle(serverId: string): ResponseStyle | undefined {
  return styles().get(serverId);
}

export function rememberServerPersonality(serverId: string, personality: HostPersonality): void {
  if (styles().get(serverId) === personality.responseStyle) return;
  setStyles((current) => new Map(current).set(serverId, personality.responseStyle));
}

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

export function createServerResponseStyle(
  server: () => ServerSummary | undefined,
  calls: HostPersonalityCalls,
): () => ResponseStyle | undefined {
  const readableServerId = () => {
    const current = server();
    return current && (current.kind === "local" || current.compatibility?.negotiatedProtocol != null)
      ? current.id
      : undefined;
  };
  createEffect(readableServerId, (serverId) => {
    if (serverId) loadServerPersonality(serverId, calls);
  });
  return () => {
    const serverId = server()?.id;
    return serverId ? serverResponseStyle(serverId) : undefined;
  };
}
