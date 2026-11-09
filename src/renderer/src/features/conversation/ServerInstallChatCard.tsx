import type { ServerSummary } from "@openbot/contracts/ipc";
import { ServerInstallCard, type ServerInstallCardStep } from "@openbot/ui/features/conversation/ServerInstallCard";
import { createMemo, createSignal, onSettled, untrack } from "solid-js";
import { retryNewServer } from "../servers/new-server-retry";

/** The server list of this client, which an install card watches for the new server. */
export interface ServerInstallWatch {
  readonly servers: readonly ServerSummary[];
  /** The server list loaded once. Before that, it is empty. */
  readonly loaded: boolean;
  /** Connects to a server again now. */
  retryConnection: (serverId: string) => Promise<unknown>;
  onOpenServer: (serverId: string) => void;
}

/**
 * The servers in the list when each card showed first, by message id. A card that scrolls out of the
 * timeline and back keeps them, so a server that came while it was away is still new.
 */
const knownServerIds = new Map<string, ReadonlySet<string>>();

export interface ServerInstallChatCardProps {
  messageId: string;
  /** The name that the command gives the server. */
  name: string | null;
  /** When the command stops working, in milliseconds since the epoch. */
  expiresAt: number;
  watch: ServerInstallWatch;
}

/**
 * The card of an install command that an agent made. A server that is not in the list when the card
 * shows, with the command's name, is the new one. A server with that name that is in the list already
 * signed in before the card showed, for example while another chat was open.
 */
export function ServerInstallChatCard(props: ServerInstallChatCardProps) {
  /** The servers in the list when the card showed, from when the list loaded. */
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
    // With a name, only that name matches: another server can sign in while the card waits.
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

  /** The server was online after the card showed. It does not start again when the connection ends. */
  const wasOnline = createMemo<boolean>((previous) => previous === true || server()?.state === "online");

  const step = (): ServerInstallCardStep => {
    const current = server();
    if (!current) return expired() ? "expired" : "waiting";
    if (current.state === "online") return "connected";
    // After the command expires, the server is one that it installed earlier.
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
