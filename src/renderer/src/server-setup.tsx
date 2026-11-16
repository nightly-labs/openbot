import { formatLocale, resolveLocale } from "@openbot/i18n";
import { render } from "@solidjs/web";
import { syncColorScheme } from "./color-scheme";
import { ServerSetupScreen } from "./features/server-setup/ServerSetupScreen";
import { StaticI18nProvider } from "./i18n-context";
import "./styles.css";

// The setup page of a server in a container (src/main/server-setup-page.ts). The main process serves
// it to a browser, so it has no preload and no `window.openbot`: it uses the browser language and the
// color scheme of the computer.
const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

syncColorScheme(() => "system");
render(
  () => (
    <StaticI18nProvider
      locale={resolveLocale("system", navigator.language)}
      formatLocale={formatLocale("system", navigator.language)}
    >
      <ServerSetupScreen />
    </StaticI18nProvider>
  ),
  root,
);
