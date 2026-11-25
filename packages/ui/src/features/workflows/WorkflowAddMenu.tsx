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
import { createEffect, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";
import { PickerActions, type PickerGroup, PickerHeading, type PickerOption, PickerRow } from "./WorkflowPicker";
import type { PortRef, WfnFields, WfnPortType } from "./workflow-board";

export type AddKey = WorkflowNodeKind | "video";

export interface AddItem {
  key: AddKey;
  kind: WorkflowNodeKind;
  label: AppTextKey;
  icon: () => JSX.Element;
  fields?: WfnFields;
}

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

const ADD_GROUPS = [
  { label: "workflow.canvas.add.inputs", items: [ITEM.trigger, ITEM.prompt, ITEM.asset] },
  { label: "workflow.canvas.add.steps", items: [ITEM.llm, ITEM.agent, ITEM.image, ITEM.video] },
  { label: "workflow.canvas.add.flow", items: [ITEM.condition, ITEM.approval, ITEM.output] },
] as const satisfies readonly { label: AppTextKey; items: readonly AddItem[] }[];

export const addGroups = (allowed: readonly WorkflowNodeKind[]) =>
  ADD_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => allowed.includes(item.kind)),
  })).filter((group) => group.items.length > 0);

export const addOption = (t: AppTranslate, item: AddItem): PickerOption<AddKey> => ({
  value: item.key,
  label: t(item.label),
  tile: item.icon,
  kind: item.kind,
});

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

export const addItem = (kind: WorkflowNodeKind): AddItem => ITEM[kind];

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

export const dropKinds = (start: PortRef, allowed: readonly WorkflowNodeKind[]) =>
  addItems(allowed).filter((item) => NEW_PORTS[item.key]?.[start.side === "out" ? "in" : "out"].includes(start.type));

export const insertKinds = (type: WfnPortType, allowed: readonly WorkflowNodeKind[]) =>
  addItems(allowed).filter((item) => NEW_PORTS[item.key]?.in.includes(type) && NEW_PORTS[item.key]?.out.includes(type));

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

export function WorkflowDropMenu(props: {
  open: boolean;
  at: () => { x: number; y: number };
  connected: boolean;
  query: string;
  groups: readonly { label: AppTextKey; items: readonly AddItem[] }[];
  onQuery: (query: string) => void;
  onPick: (item: AddItem) => void;
  onClose: () => void;
  onHeight: (height: number) => void;
}) {
  const { t } = useText();
  const choices = () => props.groups.flatMap((group) => group.items);
  const label = () => (props.connected ? t("workflow.canvas.add.connected") : t("workflow.canvas.add.node"));
  let search: HTMLInputElement | undefined;
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  createEffect(
    () => props.groups,
    () => {
      fades.remeasure();
    },
  );
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
          <div
            ref={(element) => fades.bind(element)}
            class={["wfn-search-results", fades.classes()]}
            onScroll={fades.measure}
          >
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
          <ScrollEdgeBlur fades={fades} />
        </Show>
      </Popover.Content>
    </Popover.Root>
  );
}
