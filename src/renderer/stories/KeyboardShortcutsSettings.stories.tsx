import { Heading } from "@openbot/ui";
import { KeyboardShortcutsSettings } from "@openbot/ui/features/settings/KeyboardShortcutsSettings";
import type {
  ShortcutChord,
  ShortcutCommand,
  ShortcutEnvironment,
  ShortcutOverrides,
} from "@openbot/ui/features/settings/keyboard-shortcuts";
import { withShortcut } from "@openbot/ui/features/settings/keyboard-shortcuts";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Settings/Keyboard shortcuts",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function ShortcutsStory(props: { environment: ShortcutEnvironment; overrides?: ShortcutOverrides }) {
  const [overrides, setOverrides] = createSignal<ShortcutOverrides>(props.overrides ?? {});
  const change = (command: ShortcutCommand, key: ShortcutChord | null) =>
    setOverrides(withShortcut(overrides(), command, key));
  return (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Keyboard
      </Heading>
      <div class="settings-story-panel">
        <KeyboardShortcutsSettings
          environment={props.environment}
          overrides={overrides()}
          onChange={change}
          onResetAll={() => setOverrides({})}
        />
      </div>
    </main>
  );
}

export const Mac: Story = {
  render: () => <ShortcutsStory environment={{ platform: "darwin", browser: false }} />,
};

export const Windows: Story = {
  render: () => <ShortcutsStory environment={{ platform: "win32", browser: false }} />,
};

export const Browser: Story = {
  render: () => <ShortcutsStory environment={{ platform: "darwin", browser: true }} />,
};

export const Changed: Story = {
  render: () => (
    <ShortcutsStory
      environment={{ platform: "darwin", browser: false }}
      overrides={{ newThread: { ctrl: false, alt: true, shift: false, meta: true, code: "KeyT" } }}
    />
  ),
};
