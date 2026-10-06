import { Bubble, BubbleContent, Message, MessageContent } from "@openbot/ui";
import {
  ChatScrollRail,
  chatScrollSections,
  type UnloadedHistory,
} from "@openbot/ui/features/conversation/ChatScrollRail";
import { chatDaySections, dayMarkerLabel } from "@openbot/ui/features/conversation/chat-day-markers";
import {
  calculateChatScrollMargin,
  createChatVirtualizer,
} from "@openbot/ui/features/conversation/createChatVirtualizer";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

interface StoryRow {
  id: string;
  own: boolean;
  text: string;
  createdAt: string;
}

const NOW = new Date("2026-10-06T16:00:00");

const TOPICS = [
  "the release checklist and who signs off on each step",
  "why the migration test failed on the older schema fixture",
  "the pricing page copy and the annual plan discount",
  "a flaky upload test that waits on elapsed time",
  "how the team channel routes a task to the lead agent",
  "the onboarding flow for a second provider account",
];

/** Messages over several days, each day a different length, so the segments differ. */
function storyRows(days: number[], start = 0): StoryRow[] {
  const rows: StoryRow[] = [];
  days.forEach((count, dayIndex) => {
    const day = new Date(NOW);
    day.setDate(NOW.getDate() - (days.length - 1 - dayIndex));
    for (let index = 0; index < count; index += 1) {
      const at = new Date(day);
      at.setHours(9, index * 4, 0, 0);
      const own = index % 3 === 0;
      const topic = TOPICS[dayIndex % TOPICS.length];
      rows.push({
        id: `rail-${start + rows.length}`,
        own,
        text: own
          ? `Can you look at ${topic}?`
          : `I checked ${topic}. Here is what I found in step ${index + 1}, and what I would change next.`,
        createdAt: at.toISOString(),
      });
    }
  });
  return rows;
}

/** A transcript with the same scroll container, virtualizer and day rule as the chats. */
function RailTranscript(props: { rows: StoryRow[]; unloaded?: UnloadedHistory }) {
  const { t, format } = useText();
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>();
  const [virtualRoot, setVirtualRoot] = createSignal<HTMLDivElement>();
  const [scrollMargin, setScrollMargin] = createSignal(0);
  const virtualizer = createChatVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: () => props.rows.length,
    getScrollElement: () => scrollElement() ?? null,
    estimateSize: () => 64,
    getItemKey: (index) => props.rows[index]?.id ?? index,
    keyVersion: () => `${props.rows[0]?.id ?? ""}:${props.rows.at(-1)?.id ?? ""}`,
    scrollMargin,
  });
  const days = createMemo(() => chatDaySections(props.rows, { now: NOW, t, format }));
  const sections = createMemo(() =>
    chatScrollSections({
      days: days(),
      rows: props.rows,
      itemStart: virtualizer.itemStart,
      totalSize: virtualizer.getTotalSize(),
      unloaded: props.unloaded,
      text: { t, format },
    }),
  );
  const updateMargin = () => setScrollMargin(calculateChatScrollMargin(scrollElement(), virtualRoot()));

  return (
    <div style={{ display: "flex", height: "100vh", "flex-direction": "column" }}>
      <div
        ref={(element) => {
          setScrollElement(element);
          requestAnimationFrame(() => {
            updateMargin();
            element.scrollTop = element.scrollHeight;
          });
        }}
        class="conversation-scroll"
        role="log"
      >
        <ChatScrollRail
          scrollElement={scrollElement}
          sections={sections}
          onJump={(index) => virtualizer.scrollToIndex(sections()[index]?.row ?? 0)}
        />
        <div
          ref={setVirtualRoot}
          class={["virtual-chat-list", { "virtual-chat-list-static": !virtualizer.isVirtualized() }]}
          style={{ height: virtualizer.isVirtualized() ? `${virtualizer.getTotalSize()}px` : "auto" }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(item) => {
              const row = () => props.rows[item.index];
              const marker = () => {
                const current = row();
                if (!current) return null;
                return dayMarkerLabel(props.rows[item.index - 1]?.createdAt, current.createdAt, {
                  now: NOW,
                  t,
                  format,
                });
              };
              return (
                <div
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  class="virtual-chat-row"
                  style={{
                    transform: virtualizer.isVirtualized()
                      ? `translateY(${item.start - virtualizer.scrollMargin()}px)`
                      : "none",
                  }}
                >
                  <Show when={marker()}>
                    {(label) => (
                      <div class="time-marker">
                        <span>{label()}</span>
                      </div>
                    )}
                  </Show>
                  <Message align={row()?.own ? "end" : "start"}>
                    <MessageContent>
                      <Bubble align={row()?.own ? "end" : "start"} variant={row()?.own ? "secondary" : "muted"}>
                        <BubbleContent>{row()?.text}</BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Conversation/Chat scroll rail",
  component: RailTranscript,
  args: { rows: storyRows([18, 40, 12, 30, 26, 24]) },
} satisfies Meta<typeof RailTranscript>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 150 messages over six days: the list is virtualized, so most days have no rendered row. */
export const SeveralDays: Story = {};

/** Fewer than 100 messages: every row renders. */
export const ShortHistory: Story = {
  args: { rows: storyRows([10, 22, 16]) },
};

/**
 * Two days are loaded and 600 older messages are not, back to five days ago: the top segment stands
 * for them at the loaded rows' height, so the rail shows the whole chat.
 */
export const OlderHistoryNotLoaded: Story = {
  args: {
    rows: storyRows([30, 30]),
    unloaded: { count: 600, oldestAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString() },
  },
};

/** Two days: no rail, because the transcript is short enough to read through. */
export const TwoDays: Story = {
  args: { rows: storyRows([30, 30]) },
};
