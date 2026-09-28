import { AppLogo } from "@openbot/brand";
import type { AppTextKey } from "@openbot/i18n";
import { Button, ChevronDown, Dialog, ExternalLink, Heading, IconButton, Text, TriangleAlert, X } from "@openbot/ui";
import { createEffect, createMemo, createSignal, createUniqueId, For, Match, onSettled, Show, Switch } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";
import {
  summarizeWhatsNew,
  type WhatsNewGroup,
  type WhatsNewGroupType,
  type WhatsNewNotes,
  type WhatsNewRelease,
  whatsNewEntry,
} from "./whats-new";

const GROUP_LABEL = {
  added: "update.whatsNew.group.added",
  changed: "update.whatsNew.group.changed",
  fixed: "update.whatsNew.group.fixed",
} as const satisfies Record<WhatsNewGroupType, AppTextKey>;

/** A longer fix list starts closed, so the new features stay in view. */
const OPEN_FIX_LIMIT = 3;

export interface WhatsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The version that runs now. */
  version: string;
  /** The version before the update. Null when the reader opens the dialog again from Settings. */
  previousVersion: string | null;
  notes: WhatsNewNotes;
  onRetry: () => void;
  onOpenChangelog: () => void;
}

/**
 * The notes of the versions since the last one this device ran, after an app update. It never
 * blocks the app: Escape, the overlay, the close button and "Got it" all close it.
 */
export function WhatsNewDialog(props: WhatsNewDialogProps) {
  const { t } = useText();
  const releases = (): readonly WhatsNewRelease[] => (props.notes.status === "ready" ? props.notes.releases : []);
  let doneButton: HTMLButtonElement | undefined;

  function retry(): void {
    // Retry leaves the DOM when the notes start to load, so the focus goes to "Got it" first.
    doneButton?.focus({ preventScroll: true });
    props.onRetry();
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="whats-new-backdrop">
          <Dialog.Content
            as="section"
            class="whats-new-dialog"
            onOpenAutoFocus={(event) => {
              // "Got it" takes the focus, so Enter closes the dialog and the close button shows no
              // focus ring on open.
              event.preventDefault();
              doneButton?.focus({ preventScroll: true });
            }}
          >
            <Dialog.Description class="sr-only">{t("update.whatsNew.description")}</Dialog.Description>
            {/* Mounted before the text changes, so a screen reader reads the loading state. */}
            <p class="sr-only" role="status">
              {props.notes.status === "loading" ? t("update.whatsNew.loading") : ""}
            </p>
            <IconButton
              class="whats-new-close"
              label={t("common.close")}
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
            >
              <X />
            </IconButton>

            <header class="whats-new-header">
              <AppLogo variant="production" class="whats-new-logo" />
              <Dialog.Title as="h2" class="whats-new-title">
                {t("update.whatsNew.title")}
              </Dialog.Title>
              <Text tone="muted" variant="body-sm">
                <WhatsNewVersionLine
                  version={props.version}
                  previousVersion={props.previousVersion}
                  date={releases()[0]?.date ?? ""}
                />
              </Text>
            </header>

            <WhatsNewBody notes={props.notes} releases={releases()} onRetry={retry} />

            <footer class="whats-new-actions">
              <Button type="button" variant="ghost" onClick={() => props.onOpenChangelog()}>
                {t("update.whatsNew.changelog")}
                <ExternalLink aria-hidden="true" />
              </Button>
              <Button
                ref={(element: HTMLButtonElement) => {
                  doneButton = element;
                }}
                type="button"
                variant="default"
                onClick={() => props.onOpenChange(false)}
              >
                {t("update.whatsNew.done")}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The scroll area. It owns the fades, so their observer stops when the dialog closes. */
function WhatsNewBody(props: { notes: WhatsNewNotes; releases: readonly WhatsNewRelease[]; onRetry: () => void }) {
  const { t } = useText();
  const summary = createMemo(() => summarizeWhatsNew(props.releases));
  const noticeTitleId = createUniqueId();
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  // New notes can change the scroll height while the body keeps its size.
  createEffect(summary, () => fades.remeasure());

  return (
    <div
      class={["whats-new-body", fades.classes()]}
      ref={fades.bind}
      onScroll={fades.measure}
      aria-busy={props.notes.status === "loading" ? "true" : undefined}
    >
      <Switch>
        <Match when={props.notes.status === "loading"}>
          <div class="whats-new-state">
            <Text tone="muted">{t("update.whatsNew.loading")}</Text>
          </div>
        </Match>
        <Match when={props.notes.status === "failed"}>
          <div class="whats-new-state" role="alert">
            <TriangleAlert class="whats-new-state-icon" aria-hidden="true" />
            <Heading as="h3" size="sm">
              {t("update.whatsNew.failed.title")}
            </Heading>
            <Text tone="muted">{t("update.whatsNew.failed.body")}</Text>
            <Button type="button" variant="outline" size="sm" onClick={() => props.onRetry()}>
              {t("common.retry")}
            </Button>
          </div>
        </Match>
        <Match when={summary().groups.length === 0 && summary().notices.length === 0}>
          <div class="whats-new-state">
            <Heading as="h3" size="sm">
              {t("update.whatsNew.empty.title")}
            </Heading>
            <Text tone="muted">{t("update.whatsNew.empty.body")}</Text>
          </div>
        </Match>
        <Match when>
          <Show when={summary().notices.length > 0}>
            <section class="whats-new-notice" aria-labelledby={noticeTitleId}>
              <h3 class="whats-new-notice-title" id={noticeTitleId}>
                <TriangleAlert aria-hidden="true" />
                {t("update.whatsNew.notices")}
              </h3>
              <ul class="whats-new-list">
                <For each={summary().notices}>{(notice) => <WhatsNewItem text={notice} />}</For>
              </ul>
            </section>
          </Show>
          <For each={summary().groups}>
            {(group) => <WhatsNewGroupSection group={group} onToggle={fades.remeasure} />}
          </For>
        </Match>
      </Switch>
    </div>
  );
}

function WhatsNewVersionLine(props: { version: string; previousVersion: string | null; date: string }) {
  const { t, format } = useText();
  const date = () => {
    const [year, month, day] = props.date.split("-").map(Number);
    if (!year || !month || !day) return "";
    return format.date(Date.UTC(year, month - 1, day), { dateStyle: "long", timeZone: "UTC" });
  };
  const line = () =>
    props.previousVersion
      ? t("update.whatsNew.updatedFrom", { from: props.previousVersion, to: props.version })
      : t("update.whatsNew.version", { version: props.version });

  return (
    <>
      {line()}
      <Show when={date()}>
        {(value) => (
          <>
            <span aria-hidden="true"> · </span>
            <time datetime={props.date}>{value()}</time>
          </>
        )}
      </Show>
    </>
  );
}

function WhatsNewGroupSection(props: { group: WhatsNewGroup; onToggle: () => void }) {
  const { t } = useText();
  const collapsible = () => props.group.type === "fixed" && props.group.items.length > OPEN_FIX_LIMIT;
  const [expanded, setExpanded] = createSignal(false);
  const listId = createUniqueId();
  const titleId = createUniqueId();

  function toggle(): void {
    setExpanded((value) => !value);
    props.onToggle();
  }

  return (
    <section class="whats-new-group" data-type={props.group.type} aria-labelledby={titleId}>
      <h3 class="whats-new-group-title" id={titleId}>
        <span class="whats-new-group-dot" aria-hidden="true" />
        {t(GROUP_LABEL[props.group.type])}
        <span class="whats-new-group-count" aria-hidden="true">
          {props.group.items.length}
        </span>
      </h3>
      <Show when={!collapsible() || expanded()}>
        <ul class="whats-new-list" id={listId}>
          <For each={props.group.items}>{(item) => <WhatsNewItem text={item} />}</For>
        </ul>
      </Show>
      <Show when={collapsible()}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="whats-new-toggle"
          aria-expanded={expanded() ? "true" : "false"}
          aria-controls={expanded() ? listId : undefined}
          data-expanded={expanded() ? "true" : undefined}
          onClick={toggle}
        >
          {expanded()
            ? t("update.whatsNew.hideFixes")
            : t("update.whatsNew.showFixes", { count: props.group.items.length })}
          <ChevronDown aria-hidden="true" />
        </Button>
      </Show>
    </section>
  );
}

function WhatsNewItem(props: { text: string }) {
  const entry = createMemo(() => whatsNewEntry(props.text));
  return (
    <li class="whats-new-item">
      <span class="whats-new-item-headline">{entry().headline}</span>
      <Show when={entry().detail}>{(detail) => <span class="whats-new-item-detail">{detail()}</span>}</Show>
    </li>
  );
}
