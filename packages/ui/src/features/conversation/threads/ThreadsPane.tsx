import { Button, IconButton, MessageCirclePlus, PanelRight } from "@openbot/ui";
import { sidebarMessageTime } from "@openbot/ui/features/sidebar/sidebar-filtering";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { ThreadStemMark } from "./ThreadMenu";
import { ThreadStatusMark } from "./ThreadStatusMark";
import { ThreadTitle } from "./ThreadTitle";
import type { ThreadItem } from "./thread-types";

export interface ThreadsPaneProps {
  threads: readonly ThreadItem[];
  activeId: string;
  besideIds: readonly string[];
  canStartNew: boolean;
  resizer?: JSX.Element;
  onOpen: (id: string) => void;
  onToggleBeside: (id: string) => void;
  onNew: () => void;
}

function ThreadsPaneRow(props: {
  thread: ThreadItem;
  current: boolean;
  beside: boolean;
  onOpen: () => void;
  onToggleBeside: () => void;
}) {
  const { t, format } = useText();
  const draft = () => props.thread.kind === "draft";
  return (
    <li class="threads-pane-item" data-beside={props.beside ? "" : undefined}>
      <Button
        variant="ghost"
        class="threads-pane-row"
        aria-current={props.current ? "true" : undefined}
        onClick={() => props.onOpen()}
      >
        <Show when={props.thread.stem}>{(stem) => <ThreadStemMark stem={stem()} />}</Show>
        <ThreadTitle class="threads-pane-title" title={props.thread.title} />
        <ThreadStatusMark status={props.thread.status} unread={props.thread.unread} />
        <Show when={!draft()}>
          <span class="threads-pane-time">{sidebarMessageTime(props.thread.updatedAt, format)}</span>
        </Show>
      </Button>
      <Show when={!draft()}>
        <IconButton
          variant="ghost"
          size="icon-xs"
          class="threads-pane-beside"
          label={t("conversation.threads.toSide")}
          aria-pressed={props.beside ? "true" : "false"}
          onClick={() => props.onToggleBeside()}
        >
          <PanelRight aria-hidden="true" />
        </IconButton>
      </Show>
    </li>
  );
}

export function ThreadsPane(props: ThreadsPaneProps) {
  const { t } = useText();
  return (
    <aside id="threads-panel" class="browser-panel threads-pane" aria-label={t("conversation.sidePanel.pane.threads")}>
      {props.resizer}
      <div class="threads-pane-scroll">
        <Show
          when={props.threads.length > 0}
          fallback={
            <div class="threads-pane-empty">
              <p class="threads-pane-empty-title">{t("conversation.threads.empty")}</p>
              <Button variant="secondary" size="sm" disabled={!props.canStartNew} onClick={() => props.onNew()}>
                <MessageCirclePlus aria-hidden="true" />
                {t("conversation.threads.new")}
              </Button>
            </div>
          }
        >
          <ul class="threads-pane-list" aria-label={t("conversation.threads.all")}>
            <For each={props.threads} keyed={(thread) => thread.id}>
              {(thread) => (
                <ThreadsPaneRow
                  thread={thread()}
                  current={props.activeId === thread().id}
                  beside={props.besideIds.includes(thread().id)}
                  onOpen={() => props.onOpen(thread().id)}
                  onToggleBeside={() => props.onToggleBeside(thread().id)}
                />
              )}
            </For>
          </ul>
        </Show>
      </div>
    </aside>
  );
}
