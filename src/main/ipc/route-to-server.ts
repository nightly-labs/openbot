import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";

export function routeToServer<T>(
  serverId: string,
  branches: { local: () => T | Promise<T>; remote: (serverId: string) => T | Promise<T> },
): Promise<T> {
  return Promise.resolve(serverId === LOCAL_SERVER_ID ? branches.local() : branches.remote(serverId));
}
