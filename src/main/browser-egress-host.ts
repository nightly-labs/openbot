import { EventEmitter } from "node:events";
import { isBrowserEgressTargetHost } from "@openbot/contracts/team-protocol/browser-egress-v1";
import { Effect } from "effect";
import type { RelayExit } from "../backend/browser-profiles/browser-proxy-relay";
import { BrowserEgressMux, BrowserEgressRefusedError } from "./browser-egress-mux";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";

// The host end of `browser-egress-v1`. A computer proxy sends the connections of a browser profile
// through the desktop app of one member. This registry knows which signed-in peer belongs to which
// member, and which of those peers has its egress channel open. It logs nothing: targets and bytes
// are user data.

interface BrowserEgressHostEvents {
  /** A member's computer came online or went offline. */
  changed: [];
}

interface EgressPeer {
  membershipId: string | null;
  channelOpen: boolean;
  mux: BrowserEgressMux | null;
  /** Higher is newer. The newest open peer of a member carries its connections. */
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

  /** The host peer signed in as `membershipId`, or (`null`) its session ended. */
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
    // A new member on the same peer must not get the streams of the one before.
    if (next.mux) this.#closeMux(next);
    next.membershipId = membershipId;
    this.#peers.set(peerId, next);
    this.#update(peerId, next);
  };

  /** Whether the computer of a member shares its connection now. */
  online(membershipId: string): boolean {
    return this.#current(membershipId) !== null;
  }

  /** The exit of a computer proxy. It finds the member's computer again for each connection. */
  exit(membershipId: string): RelayExit {
    return async (target, signal) => {
      const mux = this.#current(membershipId);
      if (!mux) throw new BrowserEgressRefusedError("closed");
      // The computer closes the whole channel on a frame it cannot read, so a site name that the
      // protocol refuses fails here, alone.
      if (!isBrowserEgressTargetHost(target.host)) throw new BrowserEgressRefusedError("address");
      return { stream: await mux.open(target.host, target.port, signal), early: Buffer.alloc(0) };
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
    // A channel that opens again replaces the one before; its streams ended with it.
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

  /** Opens or closes the mux of a peer to match its state, and forgets a peer with nothing left. */
  #update(peerId: string, peer: EgressPeer): void {
    const usable = peer.membershipId !== null && peer.channelOpen;
    if (usable && !peer.mux) {
      peer.order = ++this.#order;
      const mux: BrowserEgressMux = new BrowserEgressMux({
        send: (frame) => Effect.runPromise(this.#bridge.sendEgress(peerId, frame)),
        onFailure: () => {
          // A broken channel ends its streams. The client opens a new one when it shares again.
          if (peer.mux !== mux) return;
          peer.mux = null;
          void Effect.runPromise(this.#bridge.closeEgress(peerId)).catch(() => undefined);
          this.emit("changed");
        },
      });
      peer.mux = mux;
      this.emit("changed");
    } else if (!usable && peer.mux) {
      this.#closeMux(peer);
      // A signed-out peer must not keep a channel that a member opened.
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
