import type { TranslatedLocale } from "@openbot/i18n";
import { resolveLocale } from "@openbot/i18n";
import { LanguageWheel } from "@openbot/ui/features/account/LanguageWheel";
import { TextProvider } from "@openbot/ui/text";
import { createSignal, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

interface WheelArgs {
  /** The computer's language. The wheel opens on it, and it picks the flag of a shared language. */
  systemLocale: string;
  onContinue: () => void;
}

/** The wheel as the app runs it: the screen redraws in the centred language as it turns. */
function LiveWheel(props: WheelArgs) {
  const [language, setLanguage] = createSignal<TranslatedLocale>(
    untrack(() => resolveLocale("system", props.systemLocale)),
  );
  return (
    <TextProvider locale={language()}>
      <LanguageWheel
        variant="production"
        systemLocale={props.systemLocale}
        language={language()}
        onChange={setLanguage}
        onContinue={props.onContinue}
      />
    </TextProvider>
  );
}

const meta = {
  title: "Auth/LanguageWheel",
  component: LiveWheel,
  args: { systemLocale: "en-US", onContinue: fn() },
  argTypes: {
    systemLocale: {
      control: "select",
      options: [
        "en-US",
        "en-GB",
        "de-DE",
        "es-ES",
        "es-MX",
        "fr-FR",
        "fr-CA",
        "ja-JP",
        "pl-PL",
        "pt-BR",
        "ru-RU",
        "tr-TR",
      ],
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LiveWheel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const English: Story = {};

export const PolishComputer: Story = { args: { systemLocale: "pl-PL" } };

export const MexicanComputer: Story = { args: { systemLocale: "es-MX" } };
