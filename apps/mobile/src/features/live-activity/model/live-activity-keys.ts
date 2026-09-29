import {
  LIVE_ACTIVITY_SECRET_BYTES,
  type LiveActivityKeys,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const key = "openbot.mobile.live-activity-secret.v1";

let loaded: { secret: Uint8Array; keys: LiveActivityKeys } | null = null;
let loading: Promise<{ secret: Uint8Array; keys: LiveActivityKeys }> | null = null;

/**
 * The secret that seals the Live Activity content and signs its button links. Only this phone and
 * the host it gives it to know it, so Apple and the OpenBot relay cannot read or change an update.
 */
export function loadLiveActivitySecret(): Promise<{ secret: Uint8Array; keys: LiveActivityKeys }> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= (async () => {
    try {
      const stored = await SecureStore.getItemAsync(key);
      const secret = stored ? fromHex(stored) : null;
      const value = secret?.length === LIVE_ACTIVITY_SECRET_BYTES ? secret : await createSecret();
      loaded = { secret: value, keys: liveActivityKeys(value) };
      return loaded;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Sign-out makes a new secret, so a host of the removed workspace cannot update the next activity. */
export async function resetLiveActivitySecret(): Promise<void> {
  loaded = null;
  await SecureStore.deleteItemAsync(key);
}

async function createSecret(): Promise<Uint8Array> {
  const secret = Crypto.getRandomBytes(LIVE_ACTIVITY_SECRET_BYTES);
  await SecureStore.setItemAsync(key, toHex(secret));
  return secret;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) return null;
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}
