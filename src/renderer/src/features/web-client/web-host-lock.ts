/** A logical host session belongs to one account credential. Prevent tabs from replacing each other's peer. */
export async function acquireWebHostLock(accountId: string, hostId: string): Promise<() => void> {
  if (!navigator.locks)
    throw new Error("This browser cannot protect the host connection. Use a current desktop browser.");
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(`openbot.web.host:${accountId}:${hostId}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error("This host is open in another tab. Close that connection before trying again."));
          return;
        }
        resolve(release);
        await held;
      })
      .catch(reject);
  });
}
