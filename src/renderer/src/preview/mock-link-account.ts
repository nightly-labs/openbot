import { DISCONNECTED_LINK_ACCOUNT, type LinkAccountDesktopApi, type LinkAccountStatus } from "@openbot/contracts/ipc";

const MOCK_SIGN_IN_MS = 4_000;

export function createMockLinkAccount(): LinkAccountDesktopApi {
  let status = DISCONNECTED_LINK_ACCOUNT;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(status: LinkAccountStatus) => void>();
  const set = (next: LinkAccountStatus): LinkAccountStatus => {
    status = next;
    for (const listener of listeners) listener({ ...status });
    return { ...status };
  };
  const stopTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    status: async () => ({ ...status }),
    connect: async () => {
      stopTimer();
      timer = setTimeout(() => {
        timer = null;
        set({ state: "connected", email: "jenny.rosen@example.com", error: null });
      }, MOCK_SIGN_IN_MS);
      return set({ ...DISCONNECTED_LINK_ACCOUNT, state: "pending" });
    },
    cancel: async () => {
      stopTimer();
      return set(DISCONNECTED_LINK_ACCOUNT);
    },
    disconnect: async () => {
      stopTimer();
      return set(DISCONNECTED_LINK_ACCOUNT);
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
