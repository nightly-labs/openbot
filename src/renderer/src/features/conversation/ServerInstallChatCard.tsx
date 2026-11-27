import type { ServerSummary } from "@openbot/contracts/ipc";
import { ServerInstallCard, type ServerInstallCardStep } from "@openbot/ui/features/conversation/ServerInstallCard";
import { createMemo, createSignal, onSettled, untrack } from "solid-js";
import { retryNewServer } from "../servers/new-server-retry";

export interface ServerInstallWatch {
  readonly servers: readonly ServerSummary[];
  readonly loaded: boolean;
  retryConnection: (serverId: string) => Promise<unknown>;
  onOpenServer: (serverId: string) => void;
}

const knownServerIds = new Map<string, ReadonlySet<string>>();

export interface ServerInstallChatCardProps {
  messageId: string;
  name: string | null;
  expiresAt: number;
  watch: ServerInstallWatch;
}

export function ServerInstallChatCard(props: ServerInstallChatCardProps) {
  const known = createMemo<ReadonlySet<string> | undefined>((previous) => {
    if (previous) return previous;
    const saved = knownServerIds.get(untrack(() => props.messageId));
    if (saved || !props.watch.loaded) return saved;
    const ids = new Set(untrack(() => props.watch.servers).map((server) => server.id));
    knownServerIds.set(
      untrack(() => props.messageId),
      ids,
    );
    return ids;
  });
  const [expired, setExpired] = createSignal(untrack(() => Date.now() >= props.expiresAt));
  onSettled(() => {
    const remaining = untrack(() => props.expiresAt) - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  });

  const named = (server: ServerSummary) => props.name !== null && server.name === props.name;
  const server = createMemo(() => {
    const ids = known();
    if (!ids) return undefined;
    const remote = props.watch.servers.filter((candidate) => candidate.kind === "remote");
    const fresh = remote.filter((candidate) => !ids.has(candidate.id));
    if (props.name !== null) return fresh.find(named) ?? remote.find(named);
    return fresh[0];
  });
  retryNewServer(
    () => {
      const current = server();
      return current && !known()?.has(current.id) ? current : undefined;
    },
    (serverId) => props.watch.retryConnection(serverId),
  );

  const wasOnline = createMemo<boolean>((previous) => previous === true || server()?.state === "online");

  const step = (): ServerInstallCardStep => {
    const current = server();
    if (!current) return expired() ? "expired" : "waiting";
    if (current.state === "online") return "connected";
    return wasOnline() || expired() ? "offline" : "starting";
  };
  return (
    <ServerInstallCard
      step={step()}
      name={server()?.name ?? props.name}
      server={server()}
      onOpenServer={() => {
        const current = server();
        if (current) props.watch.onOpenServer(current.id);
      }}
    />
  );
}
