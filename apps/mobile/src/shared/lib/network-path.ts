import * as Network from "expo-network";
import { AppState } from "react-native";

const listeners = new Set<() => void>();
let subscriptions: { remove(): void }[] = [];
let previous: Network.NetworkStateType | undefined;

function record(state: Network.NetworkState): void {
  const type = state.isConnected === true ? state.type : undefined;
  if (type === undefined) return;
  const moved = previous !== undefined && type !== previous;
  previous = type;
  if (moved) for (const notify of listeners) notify();
}

function read(): void {
  void Network.getNetworkStateAsync()
    .then((state) => {
      if (listeners.size > 0) record(state);
    })
    .catch(() => undefined);
}

export function subscribeNetworkMoves(listener: () => void): () => void {
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
  };
}
