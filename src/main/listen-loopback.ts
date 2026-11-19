import type { Server } from "node:net";

export async function listenLoopback(server: Server, noPort: () => Error, preferredPort?: number): Promise<number> {
  if (preferredPort !== undefined) {
    try {
      return await listenOn(server, noPort, preferredPort);
    } catch {}
  }
  return listenOn(server, noPort, 0);
}

export function listenLoopbackExact(server: Server, noPort: () => Error, port: number): Promise<number> {
  return listenOn(server, noPort, port);
}

function listenOn(server: Server, noPort: () => Error, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
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
