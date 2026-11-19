import { EventEmitter } from "node:events";
import { isBrowserEgressTargetHost } from "@openbot/contracts/team-protocol/browser-egress-v1";
import { Effect } from "effect";
import { RelayAddressRefused, type RelayExit } from "../backend/browser-profiles/browser-proxy-relay";
import { BrowserEgressMux, BrowserEgressRefusedError } from "./browser-egress-mux";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";

interface BrowserEgressHostEvents {
  changed: [];
  connected: [membershipId: string];
}

interface EgressPeer {
  membershipId: string | null;
  channelOpen: boolean;
  mux: BrowserEgressMux | null;
  order: number;
}

export class BrowserEgressHost extends EventEmitter<BrowserEgressHostEvents> {
  readonly #bridge: TeamWebRtcBridge;
  readonly #peers = new Map<string, EgressPeer>();
  #order = 0;

  constructor(bridge: TeamWebRtcBridge) {
    super();
    this.#bridge = bridge;
    bridge.on("egressOpen", this.#onOpen);
    bridge.on("egressClosed", this.#onClosed);
    bridge.on("egressData", this.#onData);
    bridge.on("disconnected", this.#onDisconnected);
  }

  readonly peerMemberChanged = (peerId: string, membershipId: string | null): void => {
    const peer = this.#peers.get(peerId);
    if (membershipId === null) {
      if (!peer) return;
      peer.membershipId = null;
      this.#update(peerId, peer);
      return;
    }
    if (peer?.membershipId === membershipId) return;
    const next = peer ?? { membershipId: null, channelOpen: false, mux: null, order: 0 };
    if (next.mux) this.#closeMux(next);
    next.membershipId = membershipId;
    this.#peers.set(peerId, next);
    this.#update(peerId, next);
  };

  online(membershipId: string): boolean {
    return this.#current(membershipId) !== null;
  }

  exit(membershipId: string): RelayExit {
    return async (target, signal) => {
      const mux = this.#current(membershipId);
      if (!mux) throw new BrowserEgressRefusedError("closed");
      if (!isBrowserEgressTargetHost(target.host)) throw new BrowserEgressRefusedError("address");
      const stream = await mux.open(target.host, target.port, signal).catch((error: unknown) => {
        throw error instanceof BrowserEgressRefusedError && error.reason === "address"
          ? new RelayAddressRefused()
          : error;
      });
      return { stream, early: Buffer.alloc(0) };
    };
  }

  dispose(): void {
    this.#bridge.off("egressOpen", this.#onOpen);
    this.#bridge.off("egressClosed", this.#onClosed);
    this.#bridge.off("egressData", this.#onData);
    this.#bridge.off("disconnected", this.#onDisconnected);
    for (const peer of this.#peers.values()) if (peer.mux) this.#closeMux(peer);
    this.#peers.clear();
  }

  #current(membershipId: string): BrowserEgressMux | null {
    let best: EgressPeer | null = null;
    for (const peer of this.#peers.values())
      if (peer.membershipId === membershipId && peer.mux && (!best || peer.order > best.order)) best = peer;
    return best?.mux ?? null;
  }

  readonly #onOpen = (peerId: string): void => {
    const peer = this.#peers.get(peerId) ?? { membershipId: null, channelOpen: false, mux: null, order: 0 };
    if (peer.mux) this.#closeMux(peer);
    peer.channelOpen = true;
    this.#peers.set(peerId, peer);
    this.#update(peerId, peer);
  };

  readonly #onClosed = (peerId: string): void => {
    const peer = this.#peers.get(peerId);
    if (!peer) return;
    peer.channelOpen = false;
    this.#update(peerId, peer);
  };

  readonly #onData = (peerId: string, data: string | ArrayBuffer): void => {
    this.#peers.get(peerId)?.mux?.receive(data);
  };

  readonly #onDisconnected = (peerId: string): void => {
    const peer = this.#peers.get(peerId);
    if (!peer) return;
    this.#peers.delete(peerId);
    if (peer.mux) {
      this.#closeMux(peer);
      this.emit("changed");
    }
  };

  #update(peerId: string, peer: EgressPeer): void {
    const usable = peer.membershipId !== null && peer.channelOpen;
    if (usable && !peer.mux) {
      peer.order = ++this.#order;
      const mux: BrowserEgressMux = new BrowserEgressMux({
        send: (frame) => Effect.runPromise(this.#bridge.sendEgress(peerId, frame)),
        onFailure: () => {
          if (peer.mux !== mux) return;
          peer.mux = null;
          void Effect.runPromise(this.#bridge.closeEgress(peerId)).catch(() => undefined);
          this.emit("changed");
        },
      });
      peer.mux = mux;
      if (peer.membershipId !== null) this.emit("connected", peer.membershipId);
      this.emit("changed");
    } else if (!usable && peer.mux) {
      this.#closeMux(peer);
      if (peer.membershipId === null && peer.channelOpen)
        void Effect.runPromise(this.#bridge.closeEgress(peerId)).catch(() => undefined);
      this.emit("changed");
    }
    if (peer.membershipId === null && !peer.channelOpen) this.#peers.delete(peerId);
  }

  #closeMux(peer: EgressPeer): void {
    const mux = peer.mux;
    peer.mux = null;
    mux?.close();
  }
}
