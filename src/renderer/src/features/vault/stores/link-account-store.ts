import { DISCONNECTED_LINK_ACCOUNT, type LinkAccountDesktopApi, type LinkAccountStatus } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";

/**
 * The Link account of this computer, for the Vault page. Each call answers with the new status, and
 * main sends it again when the sign-in in the browser ends.
 */
export function createLinkAccountStore(api: () => LinkAccountDesktopApi = () => window.openbot.linkAccount) {
  const [state, setState] = createStore<{ status: LinkAccountStatus }>({ status: { ...DISCONNECTED_LINK_ACCOUNT } });
  let request = 0;

  // Sets each field, so only the parts of the row that changed render again.
  const write = (status: LinkAccountStatus) =>
    setState((draft) => {
      draft.status.state = status.state;
      draft.status.email = status.email;
      draft.status.error = status.error;
    });

  const show = (status: LinkAccountStatus) => {
    // A status that a call or an event brings is newer than one that is still loading.
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
    /** Shows each status that main sends. Returns the function that stops it. */
    subscribe: () => api().onChanged(show),
    connect: async () => show(await api().connect()),
    cancel: async () => show(await api().cancel()),
    disconnect: async () => show(await api().disconnect()),
  };
}

export type LinkAccountStore = ReturnType<typeof createLinkAccountStore>;
