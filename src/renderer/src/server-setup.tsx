import { formatLocale, resolveLocale } from "@openbot/i18n";
import { render } from "@solidjs/web";
import { syncColorScheme } from "./color-scheme";
import { ServerSetupScreen } from "./features/server-setup/ServerSetupScreen";
import { StaticI18nProvider } from "./i18n-context";
import "./styles.css";

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
