import { createEffect, createSignal } from "solid-js";
import type { CrmHost } from "./crm-port";

export interface CrmEnabled {
  enabled: () => boolean | undefined;
  set: (enabled: boolean) => Promise<void>;
}

export function createCrmEnabled(host: () => CrmHost | undefined): CrmEnabled {
  const [enabled, setEnabled] = createSignal<boolean | undefined>(undefined);
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
