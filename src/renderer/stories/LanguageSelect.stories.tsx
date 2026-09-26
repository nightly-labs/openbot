import type { AppLanguage } from "@openbot/i18n/languages";
import {
  Heading,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "@openbot/ui";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { LanguageSelect } from "../src/features/settings/LanguageSelect";

const meta = {
  title: "Settings/Language",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function LanguageRow(props: { initial?: AppLanguage; disabled?: boolean }) {
  const [language, setLanguage] = createSignal<AppLanguage>(props.initial ?? "system");
  return (
    <ItemGroup class="settings-modal-card">
      <Item class="settings-modal-row">
        <ItemContent>
          <ItemTitle>Language</ItemTitle>
          <ItemDescription>OpenBot shows menus, buttons and messages in this language.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <LanguageSelect value={language()} onChange={setLanguage} disabled={props.disabled} />
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}

/** The row as it sits in the Settings list: one section, the same shape as the rows beside it. */
export const Gallery: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Language
      </Heading>
      <div class="settings-story-panel">
        <SettingsSection title="Language">
          <LanguageRow />
        </SettingsSection>
        <SettingsSection title="Language, disabled">
          <LanguageRow initial="ja" disabled />
        </SettingsSection>
      </div>
    </main>
  ),
};

/** A selected language. Open the list to review the native names and the checked row as a set. */
export const Expanded: Story = {
  render: () => (
    <main class="foundation-story">
      <div class="settings-story-panel">
        <SettingsSection title="Language">
          <LanguageRow initial="ja" />
        </SettingsSection>
      </div>
    </main>
  ),
};
