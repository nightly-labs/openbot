import { ChevronDown, CircleCheck, LoaderCircle } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { OUTBOX_FLUSH_MESSAGE } from "./x-messages";
import { OUTBOX_KEY, type QueuedPost, readOutbox } from "./x-outbox";

const SENT_SHOWN_MS = 1_500;

export function XOutboxCard() {
  const { t } = useText();
  const [waiting, setWaiting] = createSignal<QueuedPost[]>([]);
  const [sent, setSent] = createSignal<QueuedPost[]>([]);
  const [open, setOpen] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  onSettled(() => {
    const read = () =>
      void readOutbox().then(
        (posts) => {
          if (sending()) {
            const arrived = waiting().filter((post) => !posts.some((entry) => entry.id === post.id));
            if (arrived.length) setSent((current) => [...current, ...arrived]);
          }
          setWaiting(posts);
        },
        () => undefined,
      );
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (OUTBOX_KEY in changes) read();
    };
    read();
    chrome.storage.onChanged.addListener(changed);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      chrome.storage.onChanged.removeListener(changed);
      window.clearInterval(clock);
    };
  });

  const rows = createMemo(() => [...sent(), ...waiting()].sort((left, right) => left.createdAt - right.createdAt));
  const isSent = (post: QueuedPost) => sent().some((entry) => entry.id === post.id);
  const nextIn = () => {
    const due = Math.min(...waiting().map((post) => post.nextAt));
    return Number.isFinite(due) ? Math.max(0, Math.ceil((due - now()) / 1_000)) : 0;
  };
  const title = () => {
    if (sending()) return t("extension.x.outbox.sending");
    if (!waiting().length) return t("extension.x.outbox.sent");
    return t("extension.x.outbox.title", { count: waiting().length });
  };

  function send() {
    if (sending()) return;
    setSending(true);
    setSent([]);
    void chrome.runtime
      .sendMessage({ kind: OUTBOX_FLUSH_MESSAGE })
      .catch(() => undefined)
      .finally(() => {
        setSending(false);
        window.setTimeout(() => setSent([]), SENT_SHOWN_MS);
      });
  }

  return (
    <Show when={rows().length > 0}>
      <section
        class="ph-outbox"
        aria-live="polite"
        data-open={open() ? "" : undefined}
        data-done={waiting().length === 0 ? "" : undefined}
        aria-label={title()}
      >
        <button
          type="button"
          class="ph-outbox-head"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => setOpen((value) => !value)}
        >
          <Show
            when={waiting().length > 0}
            fallback={<CircleCheck size={18} class="ph-outbox-done" aria-hidden="true" />}
          >
            <span class="ph-outbox-count">{waiting().length}</span>
          </Show>
          <span class="ph-outbox-title">{title()}</span>
          <ChevronDown size={14} aria-hidden="true" class="ph-outbox-chevron" />
        </button>
        <div class="ph-outbox-body">
          <div class="ph-outbox-inner">
            <ul class="ph-outbox-list">
              <For each={rows()}>
                {(post) => <OutboxRow post={post} sent={isSent(post)} sending={sending()} now={now()} />}
              </For>
            </ul>
            <Show when={waiting().length > 0 && !sending()}>
              <p class="ph-outbox-foot">
                {nextIn() > 0
                  ? t("extension.x.outbox.next", { time: clock(nextIn()) })
                  : t("extension.x.outbox.trying")}
              </p>
            </Show>
          </div>
        </div>
        <Show when={waiting().length > 0}>
          <button type="button" class="ph-outbox-send" disabled={sending()} onClick={send}>
            <Show when={sending()}>
              <LoaderCircle size={14} class="ch-spin" aria-hidden="true" />
            </Show>
            {t("extension.x.sendNow")}
          </button>
        </Show>
      </section>
    </Show>
  );
}

function OutboxRow(props: { post: QueuedPost; sent: boolean; sending: boolean; now: number }) {
  const { t } = useText();
  const target = () => props.post.payload.posts[props.post.payload.replyTo];
  const text = () => target()?.text || props.post.payload.message;
  const waited = () => {
    const minutes = Math.max(1, Math.round((props.now - props.post.createdAt) / 60_000));
    if (minutes < 60) return t("extension.x.outbox.minutes", { count: minutes });
    const hours = Math.round(minutes / 60);
    return hours < 48
      ? t("extension.x.outbox.hours", { count: hours })
      : t("extension.x.outbox.days", { count: Math.round(hours / 24) });
  };
  return (
    <li class="ph-outbox-row" data-sent={props.sent ? "" : undefined} title={props.post.error ?? undefined}>
      <span class="ph-outbox-mark" aria-hidden="true">
        <Show
          when={props.sent}
          fallback={
            <Show when={props.sending} fallback={<i class="ph-outbox-dot" />}>
              <LoaderCircle size={14} class="ch-spin" />
            </Show>
          }
        >
          <CircleCheck size={14} />
        </Show>
      </span>
      <span class="ph-outbox-post">
        <span class="ph-outbox-handle">{target()?.handle || target()?.authorName}</span>
        <span class="ph-outbox-snippet" dir="auto">
          {text()}
        </span>
      </span>
      <span class="ph-outbox-age">{props.sent ? t("extension.x.outbox.sentOne") : waited()}</span>
    </li>
  );
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
