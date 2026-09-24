import { type MessageTextSelection, SelectionActionsBar } from "@openbot/ui/features/conversation/SelectionActions";
import { createSignal, onSettled, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

function SelectionActionsDemo(props: {
  onSend?: (messageId: string, body: string) => Promise<boolean>;
  width?: string;
}) {
  const [selection, setSelection] = createSignal<MessageTextSelection | null>(null);
  let text: HTMLSpanElement | undefined;

  onSettled(() => {
    if (!text) return;
    const range = document.createRange();
    range.selectNodeContents(text);
    setSelection({
      messageId: "selection-actions-story",
      text: text.textContent ?? "",
      range,
    });
  });

  return (
    <div
      style={{
        width: props.width ?? "560px",
        "max-width": "calc(100vw - 48px)",
        padding: "96px 36px 120px",
        background: "var(--openbot-bg-canvas)",
        color: "var(--openbot-text-primary)",
      }}
    >
      <p style={{ margin: "0", "font-size": "14px", "line-height": "21px" }}>
        The launch note is almost ready.{" "}
        <span ref={(element) => (text = element)}>Make the closing sentence warmer and more concise.</span>
      </p>
      <Show when={selection()}>
        {(active) => (
          <SelectionActionsBar
            selection={active()}
            fallbackHighlight
            onDismiss={fn()}
            onSend={props.onSend ?? fn().mockResolvedValue(true)}
          />
        )}
      </Show>
    </div>
  );
}

const meta = {
  title: "Conversation/SelectionActions",
  component: SelectionActionsDemo,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SelectionActionsDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Narrow: Story = {
  args: { width: "280px" },
  parameters: {
    viewport: { defaultViewport: "mobile2" },
  },
};
