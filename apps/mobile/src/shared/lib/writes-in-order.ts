import * as SecureStore from "expo-secure-store";

export function writesInOrder(key: string): (value: () => string) => Promise<void> {
  let writes: Promise<void> = Promise.resolve();
  return (value) => {
    const write = writes.then(() => SecureStore.setItemAsync(key, value()));
    writes = write.catch(() => undefined);
    return write;
  };
}
