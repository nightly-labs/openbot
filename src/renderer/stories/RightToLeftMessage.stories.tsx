import { Bubble, BubbleContent } from "@openbot/ui";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const body = [
  "## راهنمای نصب OpenBot",
  "",
  "React یک کتابخانه است و با TypeScript و Node.js (نسخه 22) کار می‌کند.",
  "",
  "برای اجرا دستور `bun run dev --shared` را بزنید و سپس https://openbot.run/docs/ را ببینید.",
  "",
  "- نصب **Bun** و Git",
  "  - اجرای `bun install`",
  "- [x] تست با Vitest",
  "",
  "> نکته: فایل `.env.dev` را تغییر ندهید.",
  "",
  "| نام | توضیح |",
  "| --- | --- |",
  "| Electron | برنامه دسکتاپ |",
  "",
  "```ts",
  'const dir = "rtl";',
  "```",
  "",
  "This paragraph stays left to right, with one word: سلام.",
].join("\n");

const meta = {
  title: "Conversation/RightToLeftMessage",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each block takes its direction from its letters, so Latin product names do not change the side. */
export const AgentReply: Story = {
  render: () => (
    <div class="message-entry-agent" style={{ width: "640px" }}>
      <Bubble variant="ghost">
        <BubbleContent>
          <div class="message-copy message-markdown">
            <MarkdownMessageText body={body} agents={[]} onSelectAgent={fn()} onOpenLink={fn()} />
          </div>
        </BubbleContent>
      </Bubble>
    </div>
  ),
};
