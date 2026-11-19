import * as SecureStore from "expo-secure-store";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "openbot.after-first-unlock",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const queues = new Map<string, Promise<unknown>>();

function inOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return result;
}

export function getItemAsync(key: string): Promise<string | null> {
  return inOrder(key, async () => {
    const value = await SecureStore.getItemAsync(key, OPTIONS);
    if (value !== null) return value;
    const old = await SecureStore.getItemAsync(key);
    if (old === null) return null;
    await SecureStore.setItemAsync(key, old, OPTIONS);
    await SecureStore.deleteItemAsync(key);
    return old;
  });
}

export function setItemAsync(key: string, value: string): Promise<void> {
  return inOrder(key, async () => {
    await SecureStore.setItemAsync(key, value, OPTIONS);
    await SecureStore.deleteItemAsync(key);
  });
}

export function deleteItemAsync(key: string): Promise<void> {
  return inOrder(key, async () => {
    await SecureStore.deleteItemAsync(key, OPTIONS);
    await SecureStore.deleteItemAsync(key);
  });
}

export function getItem(key: string): string | null {
  const value = SecureStore.getItem(key, OPTIONS);
  if (value !== null) return value;
  const old = SecureStore.getItem(key);
  if (old === null) return null;
  SecureStore.setItem(key, old, OPTIONS);
  void SecureStore.deleteItemAsync(key).catch(() => undefined);
  return old;
}

export function setItem(key: string, value: string): void {
  SecureStore.setItem(key, value, OPTIONS);
  void SecureStore.deleteItemAsync(key).catch(() => undefined);
}
