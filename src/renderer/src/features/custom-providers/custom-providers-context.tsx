import { onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { customProvidersPort } from "./custom-providers-port";
import { createCustomProvidersStore } from "./stores/custom-providers-store";

const CustomProviders = createSimpleContext({
  name: "Custom providers",
  init: () => {
    const store = createCustomProvidersStore(() => customProvidersPort().customProviders);
    onSettled(() => {
      void store.refreshCustomProviders().catch(() => undefined);
    });
    return store;
  },
});

export const CustomProvidersProvider = CustomProviders.provider;
export const useCustomProviders = CustomProviders.use;
