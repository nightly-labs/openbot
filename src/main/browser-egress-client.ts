import { connect, isIP, type Socket } from "node:net";
import type { BrowserEgressRefusal } from "@openbot/contracts/team-protocol/browser-egress-v1";
import { Effect } from "effect";
import { isPublicAddress, systemAddressLookup } from "../backend/network-address";
import { BrowserEgressMux, type BrowserEgressRequest } from "./browser-egress-mux";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";

const CONNECT_TIMEOUT_MS = 20_000;

interface BrowserEgressServers {
  serverIds(): readonly string[];
  browserEgressWanted(serverId: string): boolean;
}

export class BrowserEgressClient {
  readonly #bridge: TeamWebRtcBridge;
  readonly #servers: BrowserEgressServers;
  readonly #requested = new Set<string>();
  readonly #muxes = new Map<string, BrowserEgressMux>();

  constructor(bridge: TeamWebRtcBridge, servers: BrowserEgressServers) {
    this.#bridge = bridge;
    this.#servers = servers;
    bridge.on("egressOpen", this.#onOpen);
    bridge.on("egressClosed", this.#onClosed);
    bridge.on("egressData", this.#onData);
    bridge.on("disconnected", this.#onClosed);
  }

  readonly reconcile = (): void => {
    const wanted = new Set(this.#servers.serverIds().filter((serverId) => this.#servers.browserEgressWanted(serverId)));
    for (const serverId of wanted) {
      if (this.#requested.has(serverId)) continue;
      this.#requested.add(serverId);
      void Effect.runPromise(this.#bridge.openEgress(serverId)).catch(() => this.#requested.delete(serverId));
    }
    for (const serverId of [...this.#requested]) {
      if (wanted.has(serverId)) continue;
      this.#stop(serverId);
      void Effect.runPromise(this.#bridge.closeEgress(serverId)).catch(() => undefined);
    }
  };

  dispose(): void {
    this.#bridge.off("egressOpen", this.#onOpen);
    this.#bridge.off("egressClosed", this.#onClosed);
    this.#bridge.off("egressData", this.#onData);
    this.#bridge.off("disconnected", this.#onClosed);
    for (const serverId of [...this.#requested]) this.#stop(serverId);
  }

  readonly #onOpen = (peerId: string): void => {
    if (!this.#requested.has(peerId)) return;
    this.#muxes.get(peerId)?.close();
    const mux: BrowserEgressMux = new BrowserEgressMux({
      send: (frame) => Effect.runPromise(this.#bridge.sendEgress(peerId, frame)),
      onRequest: openSite,
      onFailure: () => {
        if (this.#muxes.get(peerId) !== mux) return;
        this.#stop(peerId);
        void Effect.runPromise(this.#bridge.closeEgress(peerId)).catch(() => undefined);
      },
    });
    this.#muxes.set(peerId, mux);
  };

  readonly #onClosed = (peerId: string): void => {
    if (this.#requested.has(peerId)) this.#stop(peerId);
  };

  readonly #onData = (peerId: string, data: string | ArrayBuffer): void => {
    this.#muxes.get(peerId)?.receive(data);
  };

  #stop(serverId: string): void {
    this.#requested.delete(serverId);
    this.#muxes.get(serverId)?.close();
    this.#muxes.delete(serverId);
  }
}

function openSite({ stream, host, port }: BrowserEgressRequest): void {
  const attempt = new AbortController();
  const stop = () => attempt.abort();
  stream.once("close", stop);
  connectPublic(host, port, attempt.signal).then(
    (site) => {
      stream.off("close", stop);
      if (stream.destroyed) return site.destroy();
      site.once("close", () => stream.destroy());
      stream.once("close", () => site.destroy());
      site.on("error", () => site.destroy());
      stream.on("error", () => stream.destroy());
      stream.opened().then(
        () => {
          site.pipe(stream);
          stream.pipe(site);
        },
        () => site.destroy(),
      );
    },
    (error: unknown) => stream.refuse(error instanceof SiteRefused ? error.reason : "connect"),
  );
}

class SiteRefused extends Error {
  readonly reason: BrowserEgressRefusal;

  constructor(reason: BrowserEgressRefusal) {
    super("The site connection did not open.");
    this.reason = reason;
  }
}

async function connectPublic(host: string, port: number, signal: AbortSignal): Promise<Socket> {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  let addresses: readonly string[];
  if (isIP(bare)) addresses = [bare];
  else {
    try {
      addresses = await Effect.runPromise(systemAddressLookup(bare));
    } catch {
      throw new SiteRefused("lookup");
    }
  }
  const address = addresses.find(isPublicAddress);
  if (address === undefined) throw new SiteRefused("address");
  if (signal.aborted) throw new SiteRefused("connect");
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect({ host: address, port });
    const fail = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", fail);
      socket.destroy();
      reject(new SiteRefused("connect"));
    };
    const timer = setTimeout(fail, CONNECT_TIMEOUT_MS);
    signal.addEventListener("abort", fail, { once: true });
    socket.once("error", fail);
    socket.once("connect", () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", fail);
      socket.off("error", fail);
      resolve(socket);
    });
  });
}
