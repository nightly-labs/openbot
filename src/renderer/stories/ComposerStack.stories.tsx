import type { QueueDelivery } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import {
  ComposerNotice,
  ComposerSignInNotice,
  ComposerUpdateNotice,
  ComposerUsageLimitNotice,
} from "@openbot/ui/features/conversation/ComposerNotice";
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import { ComposerCompactionNotice } from "@openbot/ui/features/conversation/ContextUsage";
import { type OpenWaitItem, OpenWaits } from "@openbot/ui/features/conversation/OpenWaits";
import { useText } from "@openbot/ui/text";
import { type JSX, Portal } from "@solidjs/web";
import { createSignal, createStore, For, onSettled, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { MockOpenBotControls } from "../src/preview/mock-openbot";
import { openChat, PrototypeApp } from "./prototype-support";

const meta = {
  title: "Conversation/Composer stack",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function queued(id: string, position: number, text: string): QueueDelivery {
  return {
    id: `delivery-${id}`,
    messageId: `message-${id}`,
    recipientAgentId: "chief",
    sender: { kind: "user" },
    text,
    attachments: [],
    replyToMessageId: null,
    status: "queued",
    position,
    turnId: null,
    error: null,
    createdAt: "2026-08-19T09:46:00.000Z",
    expectsReply: false,
  };
}

const QUEUE: QueueDelivery[] = [
  queued("owners", 1, "Add an owner to each milestone."),
  queued(
    "pricing",
    2,
    "Also check that the pricing link in the launch plan points to the new page, and tell me which sections of the plan still name the old plans.",
  ),
  queued("send", 3, "Then send the plan to Sales Outbound."),
];

/** A fixed moment, so the times read the same on every run. */
const USAGE_RESETS_AT = Date.UTC(2026, 8, 21, 9, 0) / 1_000;
const WAITS: OpenWaitItem[] = [
  {
    id: "wait-release",
    note: "Release build of 2.14, then upload the DMG and send the link",
    request: "Ship 2.14 and tell me when the DMG is up.",
    openedAt: "2026-08-19T09:32:00.000Z",
    state: "waiting",
  },
  {
    id: "wait-pricing",
    note: "Pricing page deploy, then check the new links and finish the launch post",
    request: "Finish the launch post after the pricing page is live.",
    openedAt: "2026-08-18T07:46:00.000Z",
    state: "woken",
  },
];

/** The cards that the mock app cannot open by itself. Each one is the product component. */
const CASES = [
  "Error with a title and an action",
  "Error with a reference",
  "Warning",
  "Provider offline",
  "Provider silent",
  "Queue edit",
  "Voice limit",
  "Update required",
  "Sign in",
  "Usage limit",
  "Compaction",
  "Open waits",
] as const;
type Case = (typeof CASES)[number];

function CaseCard(props: { name: Case; onClose: () => void }): JSX.Element {
  const { t } = useText();
  switch (props.name) {
    case "Error with a title and an action":
      return (
        <ComposerErrorBanner
          title="Gemini · Gemini 3 Flash"
          message="Google must verify your account before Gemini can answer. Verify your Google account in a browser, then send your message again."
          onDismiss={props.onClose}
          action={
            <Button variant="outline" size="sm" type="button">
              Verify account
            </Button>
          }
        />
      );
    case "Error with a reference":
      return (
        <ComposerErrorBanner
          message="The agent could not continue. Try again."
          reference="auth/3f9a1c"
          onDismiss={props.onClose}
        />
      );
    case "Warning":
      return (
        <ComposerErrorBanner
          tone="warning"
          message="The model endpoint refused the request."
          onDismiss={props.onClose}
        />
      );
    case "Provider offline":
      return (
        <ComposerNotice
          title={t("composer.providerWait.offlineTitle")}
          body={t("composer.providerWait.offline", { provider: "Codex" })}
        />
      );
    case "Provider silent":
      return <ComposerNotice body={t("composer.providerWait.silent", { provider: "Codex", duration: "3 minutes" })} />;
    case "Queue edit":
      return (
        <ComposerNotice
          body={t("composer.queueEdit.body")}
          action={
            <Button variant="ghost" size="sm" type="button" onClick={props.onClose}>
              {t("composer.queueEdit.cancel")}
            </Button>
          }
        />
      );
    case "Voice limit":
      return <ComposerNotice body={t("composer.voice.limitReached")} onDismiss={props.onClose} />;
    case "Update required":
      return <ComposerUpdateNotice provider="codex" onUpdate={() => undefined} />;
    case "Sign in":
      return <ComposerSignInNotice provider="codex" onSignIn={() => undefined} />;
    case "Usage limit":
      return <ComposerUsageLimitNotice provider="codex" resetsAt={USAGE_RESETS_AT} onDismiss={props.onClose} />;
    case "Compaction":
      return <ComposerCompactionNotice startedAt={Date.now()} expectedMs={600_000} />;
    case "Open waits":
      return <OpenWaits items={WAITS} onCancel={props.onClose} />;
  }
}

/**
 * The real app, with buttons that are not part of it. Queue and Error use the app itself. Each other
 * button puts one product card into the app's card stack, so each card can open and close with the
 * others. The `@` list opens over the cards, and a reply to a message opens the reply card.
 */
function ComposerStackPlayground() {
  let root: HTMLDivElement | undefined;
  let mock: MockOpenBotControls | undefined;
  const [queueShown, setQueueShown] = createSignal(false);
  const [stack, setStack] = createSignal<Element | null>(null);
  const [shown, setShown] = createStore<Partial<Record<Case, boolean>>>({});
  const toggle = (name: Case, open: boolean) =>
    setShown((draft) => {
      draft[name] = open;
    });
  onSettled(() => {
    let frame = 0;
    let opened = false;
    const open = () => {
      if (root && !opened) opened = openChat(root, "chief");
      const element = root?.querySelector(".composer-wrap > .composer-stack") ?? null;
      if (element) {
        setStack(element);
        return;
      }
      frame = requestAnimationFrame(open);
    };
    open();
    return () => cancelAnimationFrame(frame);
  });
  return (
    <div style={{ display: "contents" }} ref={root}>
      <PrototypeApp
        setup={(controls) => {
          mock = controls;
        }}
      />
      <Show when={stack()} keyed>
        {(element) => (
          <Portal mount={element}>
            <For each={CASES}>
              {(name) => (
                <ComposerStackCard when={shown[name]}>
                  {() => <CaseCard name={name} onClose={() => toggle(name, false)} />}
                </ComposerStackCard>
              )}
            </For>
          </Portal>
        )}
      </Show>
      <div
        role="toolbar"
        aria-label="Story controls"
        aria-orientation="vertical"
        style={{
          position: "fixed",
          top: "48px",
          right: "16px",
          "z-index": 100,
          display: "flex",
          "flex-direction": "column",
          "align-items": "flex-end",
          gap: "4px",
        }}
      >
        <Button
          variant="secondary"
          size="sm"
          type="button"
          aria-pressed={queueShown() ? "true" : "false"}
          onClick={() => {
            const next = !queueShown();
            setQueueShown(next);
            mock?.setQueueSnapshot("chief", next ? QUEUE : []);
          }}
        >
          Queue
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() =>
            mock?.emitAgentEvent({
              type: "error",
              agentId: "chief",
              code: "provider_error",
              message: "stream disconnected before completion: Connection refused (os error 61)",
            })
          }
        >
          Error
        </Button>
        <For each={CASES}>
          {(name) => (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              aria-pressed={shown[name] ? "true" : "false"}
              onClick={() => toggle(name, !shown[name])}
            >
              {name}
            </Button>
          )}
        </For>
      </div>
    </div>
  );
}

export const Playground: Story = { render: () => <ComposerStackPlayground /> };
