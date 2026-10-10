import { ArrowUp, Button, Mic, Plus } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import {
  ComposerCompactionNotice,
  ContextCompactionMarker,
  type ContextCompactionView,
  ContextUsageMeter,
  type ContextUsageView,
} from "@openbot/ui/features/conversation/ContextUsage";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENTS } from "./fixtures";

/*
 * Context usage for an agent's provider thread. The data differs by provider:
 *
 * - Codex reports `tokenUsage.last.totalTokens` and `modelContextWindow`. OpenBot already asks Codex
 *   to compact at 80% (`context-compaction.ts`) and holds the queue until it ends.
 * - Claude supplies local context estimates and native compaction events. Its compacted-message
 *   count excludes system/tools, so it cannot supply a full-context before/after comparison.
 * - ACP agents can send `usage_update` (`used`, `size`) and `compaction` updates, both unstable in
 *   the protocol. An agent that sends neither shows no ring.
 */

const MINUTE = 60_000;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

const CODEX: ContextUsageView = {
  usedTokens: 168_400,
  windowTokens: 272_000,
  autoCompactAt: 0.8,
  compacting: false,
  lastCompaction: { beforeTokens: 219_000, afterTokens: 41_200 },
};

const CLAUDE: ContextUsageView = {
  usedTokens: 141_800,
  windowTokens: 200_000,
  autoCompactAt: null,
  nativeManaged: true,
  estimated: true,
  compacting: false,
};

const ACP_NO_SUMMARY: ContextUsageView = {
  usedTokens: 241_000,
  windowTokens: 256_000,
  autoCompactAt: null,
  compacting: false,
};

/** The composer's toolbar row: the ring sits with the voice and send controls, away from "+". */
function ComposerToolbar(props: { usage: ContextUsageView }) {
  return (
    <div class="composer-toolbar">
      <Button type="button" variant="ghost" class="composer-button" aria-label="Add">
        <Plus aria-hidden="true" />
      </Button>
      <div class="composer-primary-actions">
        <ContextUsageMeter usage={props.usage} />
        <Button type="button" variant="ghost" class="dictation-button" aria-label="Dictate">
          <Mic aria-hidden="true" />
        </Button>
        <Button type="submit" variant="ghost" class="voice-button" aria-label="Send message">
          <ArrowUp aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function Composer(props: { usage: ContextUsageView; notice?: JSX.Element; width?: string }) {
  const [draft, setDraft] = createSignal("");
  return (
    <div class="composer-wrap" style={{ width: props.width ?? "560px", "max-width": "calc(100vw - 32px)" }}>
      {props.notice}
      <form class="composer" data-compact="true" onSubmit={(event) => event.preventDefault()}>
        <div class="composer-input-label">
          <ComposerEditor
            agentId={STORY_AGENT.id}
            agents={STORY_AGENTS}
            value={draft()}
            placeholder={`Message ${STORY_AGENT.name}`}
            ariaLabel={`Message to ${STORY_AGENT.name}`}
            disabled={false}
            onSubmit={fn()}
            onValueChange={setDraft}
          />
        </div>
        <ComposerToolbar usage={props.usage} />
      </form>
    </div>
  );
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <section style={{ display: "grid", gap: "8px" }} aria-label={props.label}>
      <span style={{ color: "var(--openbot-text-muted)", "font-size": "var(--openbot-text-sm)" }}>{props.label}</span>
      {props.children}
    </section>
  );
}

const meta = {
  title: "Conversation/ContextUsage",
  component: ContextUsageMeter,
  args: { usage: CODEX },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ContextUsageMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open the ring to see the popover. The args drive one composer. */
export const Playground: Story = {
  render: (args) => <Composer usage={args.usage} />,
};

/** The ring through a thread's life: quiet, visible, near the compaction point, compacting, and full. */
export const RingStates: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "20px" }}>
      <Row label="18% — quiet, like the other toolbar icons">
        <Composer usage={{ ...CODEX, usedTokens: 49_000, lastCompaction: undefined }} />
      </Row>
      <Row label="62% — visible, no action needed">
        <Composer usage={CODEX} />
      </Row>
      <Row label="76% — the next turns reach the 80% compaction point">
        <Composer usage={{ ...CODEX, usedTokens: 206_700 }} />
      </Row>
      <Row label="Compacting — the queue waits">
        <Composer usage={COMPACTING} />
      </Row>
      <Row label="94% — nothing compacts this agent">
        <Composer usage={ACP_NO_SUMMARY} />
      </Row>
    </div>
  ),
};

/** Claude reports an estimate. It compacts on its own near 92%. */
export const ClaudeEstimate: Story = {
  args: { usage: CLAUDE },
  render: (args) => <Composer usage={args.usage} />,
};

/** Codex reports one total. OpenBot compacts at 80% and remembers the last result. */
export const CodexTotal: Story = {
  args: { usage: { ...CODEX, usedTokens: 206_700 } },
  render: (args) => <Composer usage={args.usage} />,
};

/** An ACP agent that reports usage but cannot compact: the ring turns red near full. */
export const NoSummary: Story = {
  args: { usage: ACP_NO_SUMMARY },
  render: (args) => <Composer usage={args.usage} />,
};

const COMPACTING: ContextUsageView = { ...CODEX, usedTokens: 219_000, compacting: true };

/** While the provider compacts, the notice above the input says why the queue does not move. */
export const CompactingNotice: Story = {
  render: () => {
    const startedAt = Date.now();
    const [failedShown, setFailedShown] = createSignal(true);
    return (
      <div style={{ display: "grid", gap: "20px" }}>
        <Row label="Running — the estimate climbs over the agent's last 20 s duration">
          <Composer
            usage={COMPACTING}
            notice={<ComposerCompactionNotice startedAt={startedAt} expectedMs={20_000} />}
          />
        </Row>
        <Row label="Slower than twice the last run — it shows the elapsed time">
          <Composer
            usage={COMPACTING}
            notice={<ComposerCompactionNotice startedAt={startedAt - 60_000} expectedMs={20_000} />}
          />
        </Row>
        <Row label="Done — the provider reported the end">
          <Composer
            usage={{ ...CODEX, usedTokens: 41_200 }}
            notice={<ComposerCompactionNotice startedAt={startedAt} status="completed" />}
          />
        </Row>
        <Row label="Failed — it stays until dismissed, and the queue continues">
          <Composer
            usage={{ ...CODEX, usedTokens: 221_400 }}
            notice={
              <Show when={failedShown()}>
                <ComposerCompactionNotice startedAt={startedAt} status="failed" onDone={() => setFailedShown(false)} />
              </Show>
            }
          />
        </Row>
      </div>
    );
  },
};

/**
 * The whole cycle: press the button. The fake provider ends after 6 s, against a 5 s estimate, and
 * the finished notice goes away 2 s later.
 */
export const CompactionCycle: Story = {
  render: () => {
    const [startedAt, setStartedAt] = createSignal<number | null>(null);
    const [completed, setCompleted] = createSignal(false);
    const compact = () => {
      setCompleted(false);
      setStartedAt(Date.now());
      window.setTimeout(() => setCompleted(true), 6_000);
    };
    return (
      <div style={{ display: "grid", gap: "12px", "justify-items": "start" }}>
        <Button type="button" variant="secondary" disabled={startedAt() !== null} onClick={compact}>
          Start compaction
        </Button>
        <Composer
          usage={{
            ...CODEX,
            usedTokens: completed() ? 41_200 : 219_000,
            compacting: startedAt() !== null && !completed(),
          }}
          notice={
            <Show when={startedAt()}>
              {(started) => (
                <ComposerCompactionNotice
                  startedAt={started()}
                  expectedMs={5_000}
                  status={completed() ? "completed" : "running"}
                  onDone={() => setStartedAt(null)}
                />
              )}
            </Show>
          }
        />
      </div>
    );
  },
};

const MARKERS: { label: string; compaction: ContextCompactionView }[] = [
  {
    label: "Running",
    compaction: { status: "running", timestamp: minutesAgo(0), beforeTokens: 219_000 },
  },
  {
    label: "Completed",
    compaction: { status: "completed", timestamp: minutesAgo(180), beforeTokens: 184_300, afterTokens: 22_900 },
  },
  {
    label: "Failed or timed out",
    compaction: { status: "failed", timestamp: minutesAgo(5), beforeTokens: 221_400 },
  },
];

/** The conversation row for each state. It replaces the silent queue hold that Codex has today. */
export const CompactionMarkers: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div class="virtual-chat-list virtual-chat-list-static" style={{ width: "720px", gap: "24px", display: "grid" }}>
      <For each={MARKERS}>
        {(marker) => (
          <Row label={marker.label}>
            <div class="virtual-chat-row">
              <ContextCompactionMarker compaction={marker.compaction} />
            </div>
          </Row>
        )}
      </For>
    </div>
  ),
};

const message = (id: string, author: "you" | "agent", body: string): AgentMessage => ({
  id,
  author,
  body,
  time: "9:12 AM",
});

/** How the pieces sit together: a compaction row in the thread, and the ring after it drops. */
export const InConversation: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <main
      class="conversation-panel"
      aria-label="Conversation"
      style={{ height: "100vh", display: "flex", "flex-direction": "column" }}
    >
      <section class="conversation-scroll" aria-label="Messages" style={{ flex: "1", overflow: "auto" }}>
        <div class="virtual-chat-list virtual-chat-list-static">
          <div class="virtual-chat-row">
            <ChatMessageRow
              message={message("m1", "you", "Pull the three hero options into one folder and list them.")}
              author={{ kind: "you", name: "You" }}
              agents={STORY_AGENTS}
              onSelectAgent={fn()}
              onOpenLink={fn()}
              onPreview={fn()}
              onAttachmentAction={fn()}
            />
          </div>
          <div class="virtual-chat-row">
            <ChatMessageRow
              message={message(
                "m2",
                "agent",
                "Done. They are in `launch/hero/`: `aurora.png`, `grid.png` and `team.png`.",
              )}
              author={{ kind: "agent", name: STORY_AGENT.name, agent: STORY_AGENT }}
              agents={STORY_AGENTS}
              onSelectAgent={fn()}
              onOpenLink={fn()}
              onPreview={fn()}
              onAttachmentAction={fn()}
            />
          </div>
          <div class="virtual-chat-row">
            <ContextCompactionMarker
              compaction={{
                status: "completed",
                timestamp: minutesAgo(1),
                beforeTokens: 219_000,
                afterTokens: 41_200,
              }}
            />
          </div>
          <div class="virtual-chat-row">
            <ChatMessageRow
              message={message("m3", "you", "Use aurora. Send the press kit next.")}
              author={{ kind: "you", name: "You" }}
              agents={STORY_AGENTS}
              onSelectAgent={fn()}
              onOpenLink={fn()}
              onPreview={fn()}
              onAttachmentAction={fn()}
            />
          </div>
        </div>
      </section>
      <div style={{ display: "flex", "justify-content": "center", padding: "0 16px 16px" }}>
        <Composer usage={{ ...CODEX, usedTokens: 44_800 }} width="720px" />
      </div>
    </main>
  ),
};
