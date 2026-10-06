import type { Server } from "node:net";

/**
 * Listens on a free loopback port and resolves that port. A failed `listen` rejects with its
 * error; a listener with no port rejects with `noPort()`. The `error` listener is removed once the
 * server listens, so it does not hold the caller after the start.
 */
export function listenLoopback(server: Server, noPort: () => Error): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    // `127.0.0.1` and not `localhost`: a name resolves to whatever the machine says it resolves
    // to, and this must be the loopback interface alone - a listener any other computer can reach
    // is a listener that can be handed a grant.
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(noPort());
        return;
      }
      resolve(address.port);
    });
  });
}
