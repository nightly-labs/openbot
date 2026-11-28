import { NotificationObserver, Toaster } from "@openbot/ui";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";
import { reportNotification } from "./error-reports";
import { WindowButtons, windowButtonsToastOffset } from "./features/window/WindowButtons";
import {
  NARROW_TOAST_EDGE_OFFSET,
  nativeBrowserPageShown,
  nativeBrowserPageToastOffset,
  TOAST_EDGE_OFFSET,
} from "./native-browser-page";
import { WindowAmbientMotion } from "./window-ambient-motion";

export function App(props: AppProps = {}) {
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
        <WindowButtons />
      </AppProviders>
      <Toaster
        hidden={nativeBrowserPageShown()}
        offset={{ ...nativeBrowserPageToastOffset(), ...windowButtonsToastOffset(TOAST_EDGE_OFFSET) }}
        mobileOffset={windowButtonsToastOffset(NARROW_TOAST_EDGE_OFFSET)}
        onToastShown={reportNotification}
      />
    </NotificationObserver>
  );
}
