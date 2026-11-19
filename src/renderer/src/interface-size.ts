import { type AppInterfaceSize, DEFAULT_APP_INTERFACE_SIZE } from "@openbot/contracts/ipc";
import { createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";

export function useInterfaceSizeChoice() {
  const [percent, setPercent] = createSignal<AppInterfaceSize>(DEFAULT_APP_INTERFACE_SIZE);
  let confirmed: AppInterfaceSize = DEFAULT_APP_INTERFACE_SIZE;
  let latestRequest = 0;
  let pending = 0;

  function confirm(next: AppInterfaceSize): void {
    confirmed = next;
    if (pending === 0) setPercent(next);
  }

  function changePercent(next: AppInterfaceSize): void {
    const request = ++latestRequest;
    pending += 1;
    setPercent(next);
    void appPort()
      .setAppInterfaceSizePreference({ percent: next })
      .then((preference) => {
        confirmed = preference.percent;
        if (request === latestRequest) setPercent(preference.percent);
      })
      .catch(() => {
        if (request === latestRequest) setPercent(confirmed);
      })
      .finally(() => {
        pending -= 1;
      });
  }

  onSettled(() => {
    void appPort()
      .getAppInterfaceSizePreference()
      .then((preference) => confirm(preference.percent))
      .catch(() => undefined);
    return appPort().onAppInterfaceSizePreference((preference) => confirm(preference.percent));
  });

  return { percent, changePercent };
}
