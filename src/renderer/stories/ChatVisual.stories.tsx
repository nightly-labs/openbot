import { ArrowUp, Button, Plus } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { ConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { Portal } from "@solidjs/web";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { OpenBotPlayground } from "../src/preview/OpenBotPlayground";
import {
  CDN_CHART,
  COMPARISON_MOCKUP,
  IMAGE_COLLAGE,
  INLINE_SVG_CHART,
  LINK_OUT,
  publishChatVisualPage,
  TALL_PAGE,
} from "./chat-visual-fixtures";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS } from "./fixtures";
import "./ChatVisual.stories.css";

/*
 * A visual reply: a page that an agent publishes above its reply, with its own scripts. The app
 * will serve the page from its own URL with a sandbox policy. Here the Storybook server does the
 * same (`.storybook/chat-visual-pages.ts`); a blob URL does not run scripts in a sandboxed frame
 * in every Chromium build.
 */

interface StageProps {
  html: string;
  title: string;
  height?: number | undefined;
  /** A page that the app is still getting, or that it cannot get. */
  state?: "loading" | "failed" | undefined;
  onOpenLink: (url: string) => void;
}

/** The page from the Storybook server. A page that the server did not keep shows as failed. */
function VisualStage(props: StageProps) {
  const [src, setSrc] = createSignal<string>();
  const [unpublished, setUnpublished] = createSignal(false);
  createEffect(
    () => props.html,
    (html) => {
      let current = true;
      setSrc(undefined);
      setUnpublished(false);
      publishChatVisualPage(html).then(
        (url) => current && setSrc(url),
        () => current && setUnpublished(true),
      );
      return () => {
        current = false;
      };
    },
  );
  return (
    <ChatVisual
      src={props.state ? undefined : src()}
      failed={props.state === "failed" || unpublished()}
      title={props.title}
      height={props.height}
      onOpenLink={props.onOpenLink}
    />
  );
}

const meta = {
  title: "Conversation/ChatVisual",
  component: VisualStage,
  args: { html: INLINE_SVG_CHART, title: "Agent runs per day", onOpenLink: fn() },
  argTypes: { html: { control: false } },
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <main style={{ width: "min(656px, 100vw)", padding: "var(--openbot-space-6)" }}>
      <VisualStage {...args} />
    </main>
  ),
} satisfies Meta<typeof VisualStage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A chart that the page's own script draws as SVG with the theme's chart colours. */
export const InlineSvgChart: Story = {};

/** Chart.js from a CDN. It needs the network, as a visual reply can load such files. */
export const CdnChart: Story = {
  args: { html: CDN_CHART, title: "Tokens per week" },
};

/** Boxes that use the card, border, radius and accent variables. */
export const ComparisonMockup: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options" },
};

/** A click on a web link calls `onOpenLink`. The script link does nothing; the page link scrolls. */
export const LinkOut: Story = {
  args: { html: LINK_OUT, title: "Sources" },
};

/** The page is higher than the limit, so the frame stops at 2000 px and the page scrolls in it. */
export const TallPage: Story = {
  args: { html: TALL_PAGE, title: "Nightly runs" },
};

/** The agent asked for 320 px, so the frame stops there and the longer page scrolls in it. */
export const AgentHeightLimit: Story = {
  args: { html: TALL_PAGE, title: "Nightly runs", height: 320 },
};

/** Screenshots that the app put into the page as data URLs when the agent published it. */
export const ImageCollage: Story = {
  args: { html: IMAGE_COLLAGE, title: "Screenshots" },
};

/** While the app gets the page, the box keeps the agent's height and shows nothing. */
export const Loading: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options", height: 180, state: "loading" },
};

/** The app cannot get the page. The text takes the same box, so the messages below do not move. */
export const LoadFailed: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options", height: 180, state: "failed" },
};

const chief = STORY_AGENT;

interface Exchange {
  id: string;
  ask: string;
  title: string;
  html: string;
  height?: number;
  state?: StageProps["state"];
  reply: string;
}

/** Each case as the app shows it: the question, the visual, then the agent's reply. */
const EXCHANGES: Exchange[] = [
  {
    id: "runs",
    ask: "How many runs did the agents do last week?",
    title: "Agent runs per day",
    html: INLINE_SVG_CHART,
    reply: "Thursday was the busiest day. Most stopped runs were on Tuesday, when the provider limit was reached.",
  },
  {
    id: "tokens",
    ask: "And how many tokens did each provider use?",
    title: "Tokens per week",
    html: CDN_CHART,
    reply: "Claude use went up each week. Grok stays below one million tokens.",
  },
  {
    id: "storage",
    ask: "Where should we keep the team data?",
    title: "Storage options",
    html: COMPARISON_MOCKUP,
    reply: "I recommend SQLite with a relay. The data stays on this computer, and the relay only passes messages.",
  },
  {
    id: "collage",
    ask: "Show me the screenshots from the release check.",
    title: "Screenshots",
    html: IMAGE_COLLAGE,
    reply: "These are the three screens that changed. The remote desktop one is new.",
  },
  {
    id: "sources",
    ask: "Where did you read about the frame sandbox?",
    title: "Sources",
    html: LINK_OUT,
    reply: "Click a source to open it in the browser.",
  },
  {
    id: "nightly",
    ask: "List the nightly runs.",
    title: "Nightly runs",
    html: TALL_PAGE,
    reply: "There are 90 runs. The list scrolls inside the visual.",
  },
  {
    id: "recent",
    ask: "Only the top of the list, please. Keep it short.",
    title: "Recent runs",
    html: TALL_PAGE,
    height: 320,
    reply: "I kept the box at 320 px. Scroll in it to see the older runs.",
  },
  {
    id: "failed",
    ask: "Show the storage options again.",
    title: "Storage options",
    html: COMPARISON_MOCKUP,
    height: 180,
    state: "failed",
    reply: "The page did not load. I can publish it again.",
  },
  {
    id: "loading",
    ask: "And the costs per month?",
    title: "Costs per month",
    html: COMPARISON_MOCKUP,
    height: 180,
    state: "loading",
    reply: "The page is loading.",
  },
];

/** The pages at the width of a phone, where the grids wrap to one column. */
export const PhoneWidth: Story = {
  render: (args) => (
    <main
      style={{
        width: "360px",
        padding: "var(--openbot-space-4)",
        display: "grid",
        gap: "var(--openbot-space-6)",
      }}
    >
      <For each={EXCHANGES.filter((exchange) => !exchange.state)}>
        {(exchange) => (
          <VisualStage
            html={exchange.html}
            title={exchange.title}
            height={exchange.height}
            onOpenLink={args.onOpenLink}
          />
        )}
      </For>
    </main>
  ),
};

const ask = (exchange: Exchange): AgentMessage => ({
  id: `${exchange.id}-ask`,
  author: "you",
  body: exchange.ask,
  time: "9:12 AM",
});
const reply = (exchange: Exchange): AgentMessage => ({
  id: `${exchange.id}-reply`,
  author: "agent",
  body: exchange.reply,
  time: "9:13 AM",
});

function AppChatStage(props: { onOpenLink: (url: string) => void }) {
  const [draft, setDraft] = createSignal("");
  return (
    <main class="conversation-panel chat-visual-chat" aria-label="Conversation">
      <ConversationHeader
        agent={chief}
        onSettingsIntent={fn()}
        onOpenSettings={fn()}
        modelPicker={{
          provider: chief.provider,
          value: chief.model,
          reasoningEffort: chief.reasoningEffort,
          modelOptions: STORY_MODELS,
          agentStatus: STORY_AGENT_STATUS,
          onChange: fn(),
          onReasoningEffortChange: fn(),
        }}
        browser={{ acting: false, open: false, onToggle: fn() }}
      />
      <section class="conversation-scroll" aria-label="Messages">
        <div class="virtual-chat-list virtual-chat-list-static">
          <div class="virtual-chat-row">
            <div class="time-marker">
              <span>Today 9:12 AM</span>
            </div>
          </div>
          <For each={EXCHANGES}>
            {(exchange) => (
              <>
                <div class="virtual-chat-row">
                  <ChatMessageRow
                    message={ask(exchange)}
                    author={{ kind: "you", name: "You" }}
                    agents={STORY_AGENTS}
                    onSelectAgent={fn()}
                    onOpenLink={fn()}
                    onPreview={fn()}
                    onAttachmentAction={fn()}
                  />
                </div>
                <div class="virtual-chat-row">
                  <VisualStage
                    html={exchange.html}
                    title={exchange.title}
                    height={exchange.height}
                    state={exchange.state}
                    onOpenLink={props.onOpenLink}
                  />
                </div>
                <div class="virtual-chat-row">
                  <ChatMessageRow
                    message={reply(exchange)}
                    author={{ kind: "agent", name: chief.name, agent: chief }}
                    agents={STORY_AGENTS}
                    onSelectAgent={fn()}
                    onOpenLink={props.onOpenLink}
                    onPreview={fn()}
                    onAttachmentAction={fn()}
                  />
                </div>
              </>
            )}
          </For>
        </div>
      </section>
      <div class="composer-wrap">
        <form class="composer" data-compact="true" onSubmit={(event) => event.preventDefault()}>
          <div class="composer-input-label">
            <ComposerEditor
              agentId={chief.id}
              agents={STORY_AGENTS}
              value={draft()}
              placeholder={`Message ${chief.name}`}
              ariaLabel={`Message to ${chief.name}`}
              disabled={false}
              onSubmit={fn()}
              onValueChange={setDraft}
            />
          </div>
          <div class="composer-toolbar">
            <Button type="button" variant="ghost" class="composer-button" aria-label="Attach files">
              <Plus aria-hidden="true" />
            </Button>
            <div class="composer-primary-actions">
              <Button type="submit" variant="ghost" class="voice-button" aria-label="Send message">
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}

/**
 * The whole app from the preview mock, with this chat in place of the app's own conversation. The
 * app has no visual replies yet, so the chat goes into the conversation area when the app draws it.
 */
function AppShellStage(props: { onOpenLink: (url: string) => void }) {
  const [content, setContent] = createSignal<HTMLElement>();
  let shell: HTMLDivElement | undefined;
  onSettled(() => {
    if (!shell) return;
    const root = shell;
    const find = () => {
      const element = root.querySelector<HTMLElement>(".usage-workspace-content");
      if (element) setContent(element);
    };
    const observer = new MutationObserver(find);
    observer.observe(root, { childList: true, subtree: true });
    find();
    return () => observer.disconnect();
  });
  return (
    <div ref={shell} class="chat-visual-app">
      <OpenBotPlayground />
      <Show when={content()}>
        {(mount) => (
          <Portal mount={mount()}>
            <AppChatStage onOpenLink={props.onOpenLink} />
          </Portal>
        )}
      </Show>
    </div>
  );
}

/** Every case in one chat, in the whole app: the server rail, the sidebar, the header and the composer. */
export const AppChat: Story = {
  render: (args) => <AppShellStage onOpenLink={args.onOpenLink} />,
};
