import { Toaster } from "@openbot/ui";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";

export function App(props: AppProps = {}) {
  return (
    <>
      <AppProviders landingPreview={props.landingPreview} peopleEnabled={props.peopleEnabled}>
        <AppAccessGate />
      </AppProviders>
      <Toaster />
    </>
  );
}
