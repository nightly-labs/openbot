import { TRANSLATED_LOCALES, type TranslatedLocale } from "@openbot/i18n";
import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import type { Preview } from "storybook-solidjs-vite";
import { StaticI18nProvider } from "../src/renderer/src/i18n-context";
import "../src/renderer/src/styles.css";
import "./preview.css";

installPointerFocusGuard();

function isTranslatedLocale(value: unknown): value is TranslatedLocale {
  return TRANSLATED_LOCALES.some((locale) => locale === value);
}

const preview: Preview = {
  // The toolbar switches every story's text, so a translation can be read in its real layout.
  globalTypes: {
    locale: {
      description: "Interface language",
      toolbar: { icon: "globe", items: [...TRANSLATED_LOCALES], dynamicTitle: true },
    },
  },
  initialGlobals: { locale: "en" },
  decorators: [
    (Story, context) => (
      <StaticI18nProvider locale={isTranslatedLocale(context.globals.locale) ? context.globals.locale : "en"}>
        <Story />
      </StaticI18nProvider>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    a11y: {
      test: "error",
    },
    controls: {
      expanded: true,
    },
  },
};

export default preview;
