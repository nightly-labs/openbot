// The user's own model endpoints: list, add, remove. `custom-provider-changes.ts` owns the order of
// the writes; the `providers-v1` host routes use the same instance.

import type { CustomProviderChanges } from "../custom-provider-changes";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "./custom-provider-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function customProviderIpcHandlers(changes: CustomProviderChanges): Pick<IpcGroupHandlers, "customProviders"> {
  return {
    customProviders: {
      list: handler(() => changes.list()),
      save: payloadHandler(parseSaveCustomProvider, (input) => changes.save(input)),
      delete: payloadHandler(parseDeleteCustomProvider, ({ id }) => changes.remove(id)),
    },
  };
}
