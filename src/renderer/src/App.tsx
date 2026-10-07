import { NotificationObserver, Toaster } from "@openbot/ui";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";
import { reportNotification } from "./error-reports";

export function App(props: AppProps = {}) {
  return (
    <NotificationObserver onShown={reportNotification}>
      <AppProviders landingPreview={props.landingPreview} peopleEnabled={props.peopleEnabled}>
        <AppAccessGate />
      </AppProviders>
      <Toaster onToastShown={reportNotification} />
    </NotificationObserver>
  );
}
