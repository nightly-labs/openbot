/**
 * The menus that add a node: the Add node menu of the bottom bar, and the menu that opens at the end of
 * a connection that the user drops on empty canvas, or on the midpoint of a connection. Each one offers
 * only the kinds that the host allows.
 */

import type { WorkflowNodeKind } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Bot,
  Button,
  buttonVariants,
  DropdownMenu,
  File,
  Film,
  Image,
  Input,
  MessageSquareText,
  Plus,
  Popover,
  Search,
  Send,
  Shapes,
  Sparkles,
  Split,
  StickyNote,
  Type,
  UserCheck,
  Zap,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { PickerActions, type PickerGroup, PickerHeading, type PickerOption, PickerRow } from "./WorkflowPicker";
import type { PortRef, WfnFields, WfnPortType } from "./workflow-board";

/** A row of the add menus. A video is an image node with the `media` field "video". */
export type AddKey = WorkflowNodeKind | "video";

export interface AddItem {
  key: AddKey;
  kind: WorkflowNodeKind;
  label: AppTextKey;
  icon: () => JSX.Element;
  /** The fields that a new node of this row starts with, before the defaults of the host. */
  fields?: WfnFields;
}

/** The name of each kind in the menus. A sticky note has a longer name than the title of its card. */
export const KIND_LABEL = {
  trigger: "workflow.trigger.title",
  prompt: "workflow.prompt.title",
  asset: "workflow.asset.title",
  llm: "workflow.llm.title",
  agent: "workflow.agent.title",
  image: "workflow.image.title",
  condition: "workflow.condition.title",
  approval: "workflow.approval.title",
  output: "workflow.output.title",
  text: "workflow.text.title",
  note: "workflow.canvas.kind.note",
  shape: "workflow.shape.title",
} satisfies Record<WorkflowNodeKind, AppTextKey>;

const item = (kind: WorkflowNodeKind, icon: () => JSX.Element): AddItem => ({
  key: kind,
  kind,
  label: KIND_LABEL[kind],
  icon,
});

const ITEM = {
  trigger: item("trigger", () => <Zap />),
  prompt: item("prompt", () => <MessageSquareText />),
  asset: item("asset", () => <File />),
  llm: item("llm", () => <Sparkles />),
  agent: item("agent", () => <Bot />),
  image: item("image", () => <Image />),
  video: {
    key: "video",
    kind: "image",
    label: "workflow.video.title",
    icon: () => <Film />,
    fields: { media: "video" },
  },
  condition: item("condition", () => <Split />),
  approval: item("approval", () => <UserCheck />),
  output: item("output", () => <Send />),
  text: item("text", () => <Type />),
  note: item("note", () => <StickyNote />),
  shape: item("shape", () => <Shapes />),
} satisfies Record<AddKey, AddItem>;

/**
 * Inputs, the steps that make something, then the flow. Text, sticky notes and shapes are for people,
 * not steps, so they are only in the bottom toolbar.
 */
const ADD_GROUPS = [
  { label: "workflow.canvas.add.inputs", items: [ITEM.trigger, ITEM.prompt, ITEM.asset] },
  { label: "workflow.canvas.add.steps", items: [ITEM.llm, ITEM.agent, ITEM.image, ITEM.video] },
  { label: "workflow.canvas.add.flow", items: [ITEM.condition, ITEM.approval, ITEM.output] },
] as const satisfies readonly { label: AppTextKey; items: readonly AddItem[] }[];

/** The groups of the add menu with only the kinds that the host allows. A group with no kind is not shown. */
export const addGroups = (allowed: readonly WorkflowNodeKind[]) =>
  ADD_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => allowed.includes(item.kind)),
  })).filter((group) => group.items.length > 0);

/** A node kind as a row of the picker: its icon on a tile in the colour of the kind. */
export const addOption = (t: AppTranslate, item: AddItem): PickerOption<AddKey> => ({
  value: item.key,
  label: t(item.label),
  tile: item.icon,
  kind: item.kind,
});

/** The icon tile and the name of a node kind, in each menu that adds a node. */
export function AddItemLabel(props: { item: AddItem }) {
  const { t } = useText();
  return (
    <>
      <span class="wfn-menu-icon" data-kind={props.item.kind} aria-hidden="true">
        {props.item.icon()}
      </span>
      <span class="wfn-menu-text">{t(props.item.label)}</span>
    </>
  );
}

/** The name and icon of a kind, for search results. Notes are not in the add menu, so this reads `ITEM`. */
export const addItem = (kind: WorkflowNodeKind): AddItem => ITEM[kind];

/**
 * The port types of a new node of each kind. A connection dropped on the canvas lists only the kinds
 * that can take it. An empty asset has no output, and the two branches of a condition need a choice,
 * so the menu does not offer them as a source.
 */
const NEW_PORTS: Partial<Record<AddKey, { in: readonly WfnPortType[]; out: readonly WfnPortType[] }>> = {
  trigger: { in: [], out: ["text"] },
  prompt: { in: [], out: ["text"] },
  llm: { in: ["text", "image", "file"], out: ["text"] },
  agent: { in: ["text", "image", "file"], out: ["text"] },
  image: { in: ["text", "image"], out: ["image"] },
  video: { in: ["text", "image"], out: ["file"] },
  condition: { in: ["text"], out: [] },
  approval: { in: ["text"], out: ["text"] },
  output: { in: ["text", "image", "file"], out: [] },
};

const addItems = (allowed: readonly WorkflowNodeKind[]) => addGroups(allowed).flatMap((group) => group.items);

/** The kinds that can take a connection from a port, in the order of the add menu. */
export const dropKinds = (start: PortRef, allowed: readonly WorkflowNodeKind[]) =>
  addItems(allowed).filter((item) => NEW_PORTS[item.key]?.[start.side === "out" ? "in" : "out"].includes(start.type));

/** The kinds that can sit in the middle of a connection of a type: they take it in and send it on. */
export const insertKinds = (type: WfnPortType, allowed: readonly WorkflowNodeKind[]) =>
  addItems(allowed).filter((item) => NEW_PORTS[item.key]?.in.includes(type) && NEW_PORTS[item.key]?.out.includes(type));

/** The Add node menu of the bottom bar. */
export function WorkflowAddMenu(props: {
  allowed: readonly WorkflowNodeKind[];
  getAnchorRect: (anchor?: HTMLElement) => DOMRect | undefined;
  onAdd: (item: AddItem) => void;
}) {
  const { t } = useText();
  const groups = (): readonly PickerGroup<AddKey>[] =>
    addGroups(props.allowed).map((group) => ({
      label: t(group.label),
      options: group.items.map((item) => addOption(t, item)),
    }));
  return (
    <DropdownMenu.Root placement="top" gutter={8} getAnchorRect={props.getAnchorRect} modal={false}>
      <DropdownMenu.Trigger class={`${buttonVariants({ size: "sm" })} wfn-hud-button wfn-hud-add-button`}>
        <Plus aria-hidden="true" />
        {t("workflow.canvas.add.node")}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerActions
          label={t("workflow.canvas.add.node")}
          groups={groups()}
          search={t("workflow.canvas.add.search")}
          onSelect={(key) => props.onAdd(ITEM[key])}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The add menu at the end of a dropped connection, or on the midpoint of a connection. It opens at a
 * point in the view, and the arrow keys move between its search field and its rows.
 */
export function WorkflowDropMenu(props: {
  open: boolean;
  /** The top-left corner of the menu, in client pixels. */
  at: () => { x: number; y: number };
  /** Whether a new node connects to a port or a connection. */
  connected: boolean;
  query: string;
  groups: readonly { label: AppTextKey; items: readonly AddItem[] }[];
  onQuery: (query: string) => void;
  onPick: (item: AddItem) => void;
  onClose: () => void;
  /** The height of the menu, so the canvas keeps it in the view. */
  onHeight: (height: number) => void;
}) {
  const { t } = useText();
  const choices = () => props.groups.flatMap((group) => group.items);
  const label = () => (props.connected ? t("workflow.canvas.add.connected") : t("workflow.canvas.add.node"));
  let search: HTMLInputElement | undefined;
  return (
    <Popover.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      getAnchorRect={() => {
        const point = props.at();
        return { x: point.x, y: point.y, width: 0, height: 0 };
      }}
      placement="bottom-start"
      gutter={0}
      flip={false}
      slide={false}
      modal={false}
    >
      <Popover.Content
        ref={(element: HTMLElement) => queueMicrotask(() => props.onHeight(element.offsetHeight))}
        class="wfn-hud wfn-search wfn-drop-menu"
        data-wfn-portal=""
        aria-label={label()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          search?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLElement }) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const items = [...event.currentTarget.querySelectorAll(".wfn-search-input, .wfn-search-result")];
          const active = document.activeElement;
          const at = active ? items.indexOf(active) : -1;
          const next = items[Math.min(Math.max(at + (event.key === "ArrowDown" ? 1 : -1), 0), items.length - 1)];
          event.preventDefault();
          if (next instanceof HTMLElement) next.focus();
        }}
      >
        <div class="wfn-search-field">
          <Search class="wfn-search-icon" aria-hidden="true" />
          <Input
            ref={(element: HTMLInputElement) => {
              search = element;
            }}
            class="wfn-search-input"
            aria-label={t("workflow.canvas.add.search")}
            placeholder={t("workflow.canvas.add.search")}
            spellcheck={false}
            value={props.query}
            onValueChange={props.onQuery}
            onKeyDown={(event) => {
              const first = choices()[0];
              if (event.key === "Enter" && first) props.onPick(first);
            }}
          />
        </div>
        <Show
          when={choices().length > 0}
          fallback={<p class="wfn-search-empty">{t("workflow.canvas.add.noMatch", { query: props.query.trim() })}</p>}
        >
          <div class="wfn-search-results">
            <For each={props.groups}>
              {(group) => (
                <fieldset class="wfn-picker-group" aria-label={t(group.label)}>
                  <PickerHeading group={{ label: t(group.label) }} />
                  <ul class="wfn-drop-list">
                    <For each={group.items}>
                      {(item) => (
                        <li>
                          <Button
                            variant="ghost"
                            size="sm"
                            class="wfn-search-result"
                            data-first={item === choices()[0] ? "" : undefined}
                            onClick={() => props.onPick(item)}
                          >
                            <PickerRow option={addOption(t, item)} />
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                </fieldset>
              )}
            </For>
          </div>
        </Show>
      </Popover.Content>
    </Popover.Root>
  );
}
