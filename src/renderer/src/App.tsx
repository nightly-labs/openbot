import { NotificationObserver, Toaster } from "@openbot/ui";
import { onSettled } from "solid-js";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";
import { reportNotification } from "./error-reports";
import { nativeBrowserPageShown, nativeBrowserPageToastOffset } from "./native-browser-page";
import { WindowAmbientMotion } from "./window-ambient-motion";
import { followWindowControlsOverlay } from "./window-controls-overlay";

export function App(props: AppProps = {}) {
  onSettled(followWindowControlsOverlay);
  return (
    <NotificationObserver onShown={reportNotification}>
      <AppProviders
        landingPreview={props.landingPreview}
        peopleEnabled={props.peopleEnabled}
        chatWindow={props.chatWindow}
      >
        <WindowAmbientMotion>
          <AppAccessGate />
        </WindowAmbientMotion>
      </AppProviders>
      <Toaster
        hidden={nativeBrowserPageShown()}
        offset={nativeBrowserPageToastOffset()}
        onToastShown={reportNotification}
      />
    </NotificationObserver>
  );
}
