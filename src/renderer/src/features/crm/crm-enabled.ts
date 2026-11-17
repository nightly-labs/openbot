import { createEffect, createSignal } from "solid-js";
import type { CrmHost } from "./crm-port";

export interface CrmEnabled {
  /** True or false from the host, or `undefined` while it is not known. */
  enabled: () => boolean | undefined;
  /** Saves the switch on the host. The host checks the role again. */
  set: (enabled: boolean) => Promise<void>;
}

/**
 * The Server Settings > Experimental switch of the CRM of `host()`. It reads the switch again when
 * the CRM of the host changes, from any device, and when the host is online again. It is `undefined`
 * while it is not known, so a caller does not close an open CRM page before the first answer.
 */
export function createCrmEnabled(host: () => CrmHost | undefined): CrmEnabled {
  const [enabled, setEnabled] = createSignal<boolean | undefined>(undefined);
  /** Bumped for each host and each change, so an earlier answer is dropped. */
  let generation = 0;
  createEffect(host, (current) => {
    generation += 1;
    setEnabled(undefined);
    if (!current) return;
    const read = () => {
      const request = generation;
      current.settings().then(
        (settings) => {
          if (request === generation) setEnabled(settings.enabled);
        },
        // An offline host keeps the last answer. The reconnect reads it again.
        () => undefined,
      );
    };
    read();
    const stop = current.onChanged(read);
    return () => {
      generation += 1;
      stop();
    };
  });
  return {
    enabled,
    async set(next) {
      const current = host();
      if (!current) return;
      const request = ++generation;
      const settings = await current.setSettings({ enabled: next });
      if (request === generation) setEnabled(settings.enabled);
    },
  };
}
