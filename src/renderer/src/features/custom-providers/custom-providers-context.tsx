import { onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { createCustomProvidersStore } from "./stores/custom-providers-store";

/**
 * The user's own model endpoints. Mounted above `ServerScopeBoundary`, unlike `ProvidersProvider`:
 * an endpoint is merged into the OpenCode process on *this* computer, so the list is machine-local
 * and a server switch must not discard and reload it.
 *
 * Ungated. Nothing waits on the list: the model picker shows OpenCode's own models meanwhile, and
 * Settings shows an empty AI providers list until it arrives.
 */
const CustomProviders = createSimpleContext({
  name: "Custom providers",
  init: () => {
    const store = createCustomProvidersStore(() => window.openbot.customProviders);
    onSettled(() => {
      // A failure here leaves the list empty and `loaded` false. The Settings tab reloads on the
      // next open, so there is nothing to retry from a mount nobody is looking at.
      void store.refreshCustomProviders().catch(() => undefined);
    });
    return store;
  },
});

export const CustomProvidersProvider = CustomProviders.provider;
export const useCustomProviders = CustomProviders.use;
