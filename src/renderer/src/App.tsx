import { NotificationObserver, Toaster } from "@openbot/ui";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";
import { reportNotification } from "./error-reports";
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
      </AppProviders>
      <Toaster onToastShown={reportNotification} />
    </NotificationObserver>
  );
}
