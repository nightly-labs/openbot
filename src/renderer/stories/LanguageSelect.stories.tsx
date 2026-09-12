import { createSignal } from "solid-js";
import { expect, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  Heading,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "../src/components/ui";
import type { AppLanguage } from "../src/features/settings/app-languages";
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
  play: async ({ canvas, userEvent }) => {
    // The trigger reads its label and its value, so match the start of the name.
    const trigger = canvas.getAllByRole("button", { name: /^Language/ })[0];
    await userEvent.click(trigger);
    const body = within(document.body);
    await userEvent.click(await body.findByRole("option", { name: "日本語" }));
    await expect(trigger).toHaveTextContent("日本語");
  },
};

/** The list left open, so the native names and the checked row can be reviewed as a set. */
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
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /^Language/ });
    await userEvent.click(trigger);
    const body = within(document.body);
    await expect(await body.findByRole("option", { name: "日本語" })).toHaveAttribute("aria-selected", "true");
  },
};
