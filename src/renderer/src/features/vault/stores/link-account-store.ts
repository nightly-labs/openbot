import { DISCONNECTED_LINK_ACCOUNT, type LinkAccountDesktopApi, type LinkAccountStatus } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";

export function createLinkAccountStore(api: () => LinkAccountDesktopApi = () => window.openbot.linkAccount) {
  const [state, setState] = createStore<{ status: LinkAccountStatus }>({ status: { ...DISCONNECTED_LINK_ACCOUNT } });
  let request = 0;

  const write = (status: LinkAccountStatus) =>
    setState((draft) => {
      draft.status.state = status.state;
      draft.status.email = status.email;
      draft.status.error = status.error;
    });

  const show = (status: LinkAccountStatus) => {
    request++;
    write(status);
  };

  return {
    state,
    refresh: async () => {
      const current = ++request;
      const status = await api().status();
      if (current === request) write(status);
    },
    subscribe: () => api().onChanged(show),
    connect: async () => show(await api().connect()),
    cancel: async () => show(await api().cancel()),
    disconnect: async () => show(await api().disconnect()),
  };
}

export type LinkAccountStore = ReturnType<typeof createLinkAccountStore>;
