import * as Network from "expo-network";
import { AppState } from "react-native";

/**
 * Tells when the phone moves to another kind of network, such as from Wi-Fi to mobile data, so the
 * connections can start again on the new network. The WebView's `online` event does not fire
 * for that move, and a connection on the old network can stay open with no data. A return to the
 * app reads the network again, because a move in the background reports no change on some phones.
 * A loss of the network is not a move: the next connected network is compared with the one before it.
 */
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

/** Calls `listener` at each move to another kind of network. Returns the function that stops it. */
export function subscribeNetworkMoves(listener: () => void): () => void {
  listeners.add(listener);
  if (subscriptions.length === 0) {
    subscriptions = [
      Network.addNetworkStateListener(record),
      AppState.addEventListener("change", (state) => {
        if (state === "active") read();
      }),
    ];
    // The listener reports only changes: without the current network, it would miss the first move.
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
