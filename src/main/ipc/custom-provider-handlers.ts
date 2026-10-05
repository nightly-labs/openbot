// The user's own model endpoints: list, add, edit, remove. Edit is local only. `custom-provider-changes.ts` owns the order of
// the writes; the `providers-v1` host routes use the same instance.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { CustomProviderChanges } from "../custom-provider-changes";
import {
  parseDeleteCustomProvider,
  parseSaveCustomProvider,
  parseUpdateCustomProvider,
} from "./custom-provider-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function customProviderIpcHandlers(changes: CustomProviderChanges): Pick<IpcGroupHandlers, "customProviders"> {
  return {
    customProviders: {
      list: handler(() => changes.list()),
      save: payloadHandler(parseSaveCustomProvider, (input) => runCauseEffect(changes.save(input))),
      delete: payloadHandler(parseDeleteCustomProvider, ({ id }) => runCauseEffect(changes.remove(id))),
      update: payloadHandler(parseUpdateCustomProvider, (input) => runCauseEffect(changes.update(input))),
    },
  };
}
