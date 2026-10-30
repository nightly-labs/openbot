import { NotificationObserver, Toaster } from "@openbot/ui";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";
import { reportNotification } from "./error-reports";

export function App(props: AppProps = {}) {
  return (
    <NotificationObserver onShown={reportNotification}>
      <AppProviders
        landingPreview={props.landingPreview}
        peopleEnabled={props.peopleEnabled}
        chatWindow={props.chatWindow}
      >
        <AppAccessGate />
      </AppProviders>
      {/* The stack starts under the 38px window header, so a toast never covers the header controls. */}
      <Toaster onToastShown={reportNotification} offset={{ top: 46 }} />
    </NotificationObserver>
  );
}
