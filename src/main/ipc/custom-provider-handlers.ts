import { Effect } from "effect";
// The user's own model endpoints: list, add, edit, remove. Edit is local only. `custom-provider-changes.ts` owns the order of
// the writes; the `providers-v1` host routes use the same instance.

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
      save: payloadHandler(parseSaveCustomProvider, (input) =>
        Effect.runPromise(changes.save(input).pipe(Effect.mapError((error) => error.cause))),
      ),
      delete: payloadHandler(parseDeleteCustomProvider, ({ id }) =>
        Effect.runPromise(changes.remove(id).pipe(Effect.mapError((error) => error.cause))),
      ),
      update: payloadHandler(parseUpdateCustomProvider, (input) =>
        Effect.runPromise(changes.update(input).pipe(Effect.mapError((error) => error.cause))),
      ),
    },
  };
}
