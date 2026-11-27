import type { AppInfo } from "@openbot/contracts/ipc";
import { createSignal, flush, onSettled } from "solid-js";
import { appPort } from "./app-port";
import type { AppProps } from "./app-providers";
import { setDrawsOnCpu } from "./motion-preference";
import { createSimpleContext } from "./simple-context";

const Platform = createSimpleContext({
  name: "Platform",
  init: (props: AppProps & { appInfo?: AppInfo }) => {
    const [appInfo, setAppInfo] = createSignal<AppInfo | null>(props.appInfo ?? null);
    const [appFocused, setAppFocused] = createSignal(document.hasFocus());
    let infoFromHost = false;
    let appFrame: HTMLDivElement | undefined;

    onSettled(() => {
      const handleBlur = () => flush(() => setAppFocused(false));
      const handleFocus = () => flush(() => setAppFocused(true));
      window.addEventListener("blur", handleBlur);
      window.addEventListener("focus", handleFocus);
      if (!props.appInfo)
        void appPort()
          .getAppInfo()
          .then((info) => {
            infoFromHost = true;
            if (info.softwareRendering) setDrawsOnCpu(true);
            setAppInfo(info);
          })
          .catch(() =>
            setAppInfo({
              name: "OpenBot",
              version: "unavailable",
              platform: "darwin",
              variant: "production",
            }),
          );
      return () => {
        window.removeEventListener("blur", handleBlur);
        window.removeEventListener("focus", handleFocus);
      };
    });

    return {
      appInfo,
      appFocused,
      appInfoLoadedFromHost: () => infoFromHost,
      landingPreview: props.landingPreview === true,
      peopleEnabled: props.peopleEnabled === true,
      chatWindow: props.chatWindow ?? null,
      appFrame: () => appFrame,
      setAppFrameElement: (element: HTMLDivElement) => {
        appFrame = element;
      },
    };
  },
});

export const PlatformProvider = Platform.provider;
export const usePlatform = Platform.use;
