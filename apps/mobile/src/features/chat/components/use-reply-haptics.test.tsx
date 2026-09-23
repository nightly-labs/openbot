import { act, useLayoutEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { haptics } from "@/shared/lib/haptics";
import { parseChatMarkdown } from "../model/chat-markdown-parser";
import type { ChatMessage } from "../model/chat-messages";
import { createReplyReveal } from "../model/reply-reveal";
import { useMessageArrivals } from "./use-message-arrivals";
import { useReplyHaptics } from "./use-reply-haptics";
import { useReplyPlayback } from "./use-reply-playback";

// Native feedback has no injectable runtime in the DOM harness.
vi.mock("@/shared/lib/haptics", () => ({
  haptics: { impact: vi.fn(), selection: vi.fn(), notification: vi.fn() },
}));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
});

function mount(body = "One two three.") {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const progress = new Map<string, number>();
  let visible: string[] = [];
  function Reply({ enabled, text, complete }: { enabled: boolean; text: string; complete: boolean }) {
    const plan = useMemo(() => createReplyReveal(parseChatMarkdown(text)), [text]);
    const feedback = useReplyHaptics(enabled);
    const tokens = useReplyPlayback(plan, { id: "reply", progress, enabled, complete, ...feedback });
    useLayoutEffect(() => {
      visible = createReplyReveal(tokens).words;
    }, [tokens]);
    return null;
  }
  return {
    render: async (enabled = true, text = body, complete = true) => {
      await act(() => root.render(<Reply enabled={enabled} text={text} complete={complete} />));
    },
    remove: async () => {
      await act(() => root.render(null));
    },
    visible: () => visible,
    progress,
  };
}
const tick = async () => {
  await act(() => vi.runOnlyPendingTimers());
};

it("starts an arrival when a pending reply completes, but not when history loads", async () => {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  let arrivals = new Set<string>();
  function Chat({ messages, enabled }: { messages: ChatMessage[]; enabled: boolean }) {
    const value = useMessageArrivals("chat", messages, enabled);
    useLayoutEffect(() => {
      arrivals = value;
    }, [value]);
    return null;
  }
  const pending: ChatMessage = {
    kind: "message",
    id: "pending",
    author: "agent",
    body: "Incomplete",
    streaming: true,
    status: "streaming",
  };
  await act(() => root.render(<Chat messages={[pending]} enabled />));
  expect(arrivals.size).toBe(0);
  const complete: ChatMessage = { ...pending, body: "Complete reply", streaming: false, status: "completed" };
  await act(() => root.render(<Chat messages={[complete]} enabled />));
  expect(arrivals.has("pending")).toBe(true);
  await act(() => root.render(<Chat messages={[complete]} enabled={false} />));
  await act(() => root.render(<Chat messages={[complete]} enabled />));
  expect(arrivals.size).toBe(0);
});

it("reveals incoming text before completion and continues when more chunks arrive", async () => {
  vi.useFakeTimers();
  const chat = mount();
  await chat.render(true, "One ", false);
  await tick();
  expect(chat.visible()).toEqual(["One "]);
  await tick();
  expect(haptics.notification).not.toHaveBeenCalled();
  await chat.render(true, "One two ", false);
  await tick();
  expect(chat.visible()).toEqual(["One ", "two "]);
  await chat.render(true, "One two three.", false);
  await tick();
  expect(chat.visible()).toHaveLength(3);
  await tick();
  expect(haptics.notification).not.toHaveBeenCalled();
  await chat.render(true, "One two three.", true);
  await tick();
  expect(haptics.notification).toHaveBeenCalledExactlyOnceWith("success");
  expect(haptics.selection).toHaveBeenCalledTimes(1);
});

it("does not postpone the reveal when chunks arrive faster than the playback clock", async () => {
  vi.useFakeTimers();
  const chat = mount();
  await chat.render(true, "One ", false);
  await act(() => vi.advanceTimersByTime(16));
  await chat.render(true, "One two ", false);
  await act(() => vi.advanceTimersByTime(16));
  expect(chat.visible()).toEqual(["One "]);
  expect(haptics.impact).toHaveBeenCalledExactlyOnceWith("soft");
});

it("reveals a complete reply word by word with varied pulses, then signals completion", async () => {
  vi.useFakeTimers();
  const chat = mount();
  await chat.render();
  expect(chat.visible()).toEqual([]);
  await tick();
  expect(chat.visible()).toEqual(["One "]);
  expect(haptics.impact).toHaveBeenCalledExactlyOnceWith("soft");
  await tick();
  expect(chat.visible()).toEqual(["One ", "two "]);
  expect(haptics.selection).toHaveBeenCalledTimes(1);
  await tick();
  expect(chat.visible()).toEqual(["One ", "two ", "three."]);
  expect(haptics.impact).toHaveBeenLastCalledWith("light");
  expect(haptics.notification).not.toHaveBeenCalled();
  await tick();
  expect(haptics.notification).toHaveBeenCalledExactlyOnceWith("success");
  await chat.render();
  await tick();
  expect(haptics.notification).toHaveBeenCalledTimes(1);
});

it("shows history immediately without feedback or a replay when it becomes active", async () => {
  vi.useFakeTimers();
  const chat = mount();
  await chat.render(false);
  expect(chat.visible()).toHaveLength(3);
  await chat.render();
  await tick();
  expect(haptics.impact).not.toHaveBeenCalled();
  expect(haptics.selection).not.toHaveBeenCalled();
  expect(haptics.notification).not.toHaveBeenCalled();
});

it("stops word and completion feedback when the app becomes inactive", async () => {
  vi.useFakeTimers();
  const chat = mount();
  await chat.render();
  await tick();
  await chat.render(false);
  await tick();
  expect(chat.visible()).toHaveLength(3);
  expect(haptics.impact).toHaveBeenCalledTimes(1);
  expect(haptics.selection).not.toHaveBeenCalled();
  expect(haptics.notification).not.toHaveBeenCalled();
});

it("cancels unmounted playback and resumes without replaying words already shown", async () => {
  vi.useFakeTimers();
  const chat = mount();
  await chat.render();
  await tick();
  await chat.remove();
  await tick();
  expect(haptics.selection).not.toHaveBeenCalled();
  await chat.render();
  expect(chat.visible()).toEqual(["One "]);
  await tick();
  expect(chat.visible()).toEqual(["One ", "two "]);
  expect(haptics.impact).toHaveBeenCalledTimes(1);
  expect(haptics.selection).toHaveBeenCalledTimes(1);
});
