import type { RoutineFeedDesktopApi } from "@openbot/contracts/ipc";

/** A feed that starts off. Each `create` gives a new token, as the real one does. */
export function createMockRoutineFeed(): RoutineFeedDesktopApi {
  let url: string | null = null;
  const feed = () => ({ url });
  return {
    get: async () => feed(),
    create: async () => {
      url = `http://127.0.0.1:52817/routines/${crypto.randomUUID().replaceAll("-", "")}.ics`;
      return feed();
    },
    remove: async () => {
      url = null;
      return feed();
    },
  };
}
