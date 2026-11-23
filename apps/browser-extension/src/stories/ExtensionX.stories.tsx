import type { Meta, StoryObj } from "storybook-solidjs-vite";
import xContentCss from "../../public/x-content.css?inline";
import "./stories.css";

const meta = {
  title: "Extension/On X",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ReplyArea(props: { state?: "armed" | "leaving"; text: string; label: string }) {
  return (
    <section class="ext-story-x" aria-label={props.label}>
      <style>{xContentCss}</style>
      <span class="ext-story-x-label">{props.label}</span>
      <div class="ext-story-x-row">
        <div class="ext-story-x-box">{props.text}</div>
        <button type="button" class="ext-story-x-button" data-openbot-x={props.state}>
          Reply
        </button>
      </div>
    </section>
  );
}

export const ReplyButton: Story = {
  render: () => <ReplyArea text="Nice thread, thanks." label="Without @OpenBot_" />,
};

export const ReplyButtonOpenBot: Story = {
  render: () => <ReplyArea state="armed" text="@OpenBot_ is the claim in this thread true?" label="With @OpenBot_" />,
};

export const ReplyButtonLeaving: Story = {
  render: () => <ReplyArea state="leaving" text="is the claim in this thread true?" label="Mention removed" />,
};
