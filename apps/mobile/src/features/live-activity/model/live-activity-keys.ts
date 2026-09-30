import {
  LIVE_ACTIVITY_SECRET_BYTES,
  type LiveActivityKeys,
  liveActivityHostSecret,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const key = "openbot.mobile.live-activity-secret.v1";

/** The secret and keys that one host has. */
export interface LiveActivityHostKeys {
  secret: Uint8Array;
  keys: LiveActivityKeys;
}

let loaded: Uint8Array | null = null;
let loading: Promise<Uint8Array> | null = null;
const hosts = new Map<string, LiveActivityHostKeys>();

/**
 * The phone secret. Each host gets its own secret made from it, which seals the Live Activity
 * content and signs its button links. So Apple and the OpenBot relay cannot read or change an
 * update, and one host cannot sign an action for another.
 */
export function loadLiveActivitySecret(): Promise<Uint8Array> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= (async () => {
    try {
      const stored = await SecureStore.getItemAsync(key);
      const secret = stored ? fromHex(stored) : null;
      loaded = secret?.length === LIVE_ACTIVITY_SECRET_BYTES ? secret : await createSecret();
      return loaded;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** The secret and keys of one host, made from the phone secret. */
export function liveActivityHostKeys(phoneSecret: Uint8Array, serverId: string): LiveActivityHostKeys {
  const cached = hosts.get(serverId);
  if (cached) return cached;
  const secret = liveActivityHostSecret(phoneSecret, serverId);
  const value = { secret, keys: liveActivityKeys(secret) };
  hosts.set(serverId, value);
  return value;
}

/** Sign-out makes a new secret, so a host of the removed workspace cannot update the next activity. */
export async function resetLiveActivitySecret(): Promise<void> {
  loaded = null;
  hosts.clear();
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
