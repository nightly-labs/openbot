import * as Network from "expo-network";
import { AppState } from "react-native";
import { type NetworkChange, type NetworkPoint, networkChange, strongerChange, usableAddress } from "./network-change";

const SETTLE_MS = 1_000;

const listeners = new Set<(change: NetworkChange) => void>();
let subscriptions: { remove(): void }[] = [];
let previous: NetworkPoint | undefined;
let pending: NetworkChange | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let reading = 0;

function emit(): void {
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = null;
  const change = pending;
  pending = null;
  if (change) for (const notify of listeners) notify(change);
}

async function point(state: Network.NetworkState): Promise<NetworkPoint | undefined> {
  if (state.isConnected !== true || !state.type || state.type === Network.NetworkStateType.NONE) return undefined;
  const address = await Network.getIpAddressAsync().catch(() => null);
  return { type: state.type, address: usableAddress(address) };
}

function record(state: Network.NetworkState): void {
  const current = ++reading;
  void point(state).then((next) => {
    if (current !== reading || !next || listeners.size === 0) return;
    const change = previous ? networkChange(previous, next) : null;
    previous = next.address === null && previous?.type === next.type ? { ...next, address: previous.address } : next;
    if (!change) return;
    pending = strongerChange(pending, change);
    if (pending === "moved") emit();
    else settleTimer ??= setTimeout(emit, SETTLE_MS);
  });
}

function read(): void {
  void Network.getNetworkStateAsync()
    .then((state) => {
      if (listeners.size > 0) record(state);
    })
    .catch(() => undefined);
}

export function subscribeNetworkMoves(listener: (change: NetworkChange) => void): () => void {
  listeners.add(listener);
  if (subscriptions.length === 0) {
    subscriptions = [
      Network.addNetworkStateListener(record),
      AppState.addEventListener("change", (state) => {
        if (state === "active") read();
      }),
    ];
    read();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    for (const subscription of subscriptions) subscription.remove();
    subscriptions = [];
    previous = undefined;
    pending = null;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
}
