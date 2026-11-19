import { WORKFLOW_GROUP_FIELDS } from "@openbot/contracts/ipc";
import { Button, Image as ImageIcon, Input, Layers } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import {
  PORT_NAME,
  type WfnFieldPatch,
  type WfnFields,
  type WfnFieldValue,
  type WfnPortType,
  type WfnRunStatus,
} from "./workflow-board";
import type { Box } from "./workflow-ink";
import { PortIcon } from "./workflow-node-parts";

export interface CanvasGroup {
  id: string;
  name: string;
  folded: boolean;
  members: readonly string[];
}

const GROUP_PAD = 28;
const GROUP_LABEL = 32;
const PORT_ROOM = 40;
const STACK_SIZE = { width: 248, height: 216 } as const;
const PORT_STEP = 34;
export const STACK_PICTURES = 3;
const PORT_ORDER: readonly WfnPortType[] = ["text", "image", "file"];

export const outputTypes = (outputs: readonly (readonly WfnPortType[])[]) =>
  PORT_ORDER.filter((type) => outputs.some((list) => list.includes(type)));

export function groupsOf(ids: readonly string[], field: (id: string, key: string) => WfnFieldValue | undefined) {
  const found = new Map<string, CanvasGroup>();
  for (const id of ids) {
    const group = field(id, WORKFLOW_GROUP_FIELDS.id);
    if (typeof group !== "string" || group === "") continue;
    const entry = found.get(group);
    if (entry) {
      found.set(group, { ...entry, members: [...entry.members, id] });
      continue;
    }
    const name = field(id, WORKFLOW_GROUP_FIELDS.name);
    found.set(group, {
      id: group,
      name: typeof name === "string" ? name : "",
      folded: field(id, WORKFLOW_GROUP_FIELDS.folded) === true,
      members: [id],
    });
  }
  return [...found.values()].filter((group) => group.members.length > 1);
}

export const sameGroups = (one: readonly CanvasGroup[], other: readonly CanvasGroup[]) =>
  JSON.stringify(one) === JSON.stringify(other);

export function joinPatch(ids: readonly string[], name: string, folded = false): WfnFieldPatch {
  const id = `group-${crypto.randomUUID()}`;
  return Object.fromEntries(
    ids.map((member) => [
      member,
      {
        [WORKFLOW_GROUP_FIELDS.id]: id,
        [WORKFLOW_GROUP_FIELDS.name]: name,
        [WORKFLOW_GROUP_FIELDS.folded]: folded || undefined,
      },
    ]),
  );
}

export function leavePatch(ids: readonly string[]): WfnFieldPatch {
  return Object.fromEntries(
    ids.map((member) => [
      member,
      {
        [WORKFLOW_GROUP_FIELDS.id]: undefined,
        [WORKFLOW_GROUP_FIELDS.name]: undefined,
        [WORKFLOW_GROUP_FIELDS.folded]: undefined,
      },
    ]),
  );
}

export function groupPatch(group: CanvasGroup, key: string, value: WfnFieldValue | undefined): WfnFieldPatch {
  return Object.fromEntries(group.members.map((member) => [member, { [key]: value }]));
}

export function regroupCopies(fields: Record<string, WfnFields>): Record<string, WfnFields> {
  const counts = new Map<string, number>();
  for (const entry of Object.values(fields)) {
    const group = entry[WORKFLOW_GROUP_FIELDS.id];
    if (typeof group === "string") counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const fresh = new Map([...counts.keys()].map((group) => [group, `group-${crypto.randomUUID()}`]));
  return Object.fromEntries(
    Object.entries(fields).map(([id, entry]) => {
      const group = entry[WORKFLOW_GROUP_FIELDS.id];
      if (typeof group !== "string") return [id, entry];
      const {
        [WORKFLOW_GROUP_FIELDS.id]: _id,
        [WORKFLOW_GROUP_FIELDS.name]: _name,
        [WORKFLOW_GROUP_FIELDS.folded]: _folded,
        ...rest
      } = entry;
      const next = fresh.get(group);
      return [id, (counts.get(group) ?? 0) > 1 && next ? { ...entry, [WORKFLOW_GROUP_FIELDS.id]: next } : rest];
    }),
  );
}

export function frameBox(group: CanvasGroup, members: Box): Box {
  if (group.folded) return { x: members.x, y: members.y, ...STACK_SIZE };
  return {
    x: members.x - GROUP_PAD,
    y: members.y - GROUP_PAD - GROUP_LABEL,
    width: members.width + GROUP_PAD * 2 + PORT_ROOM,
    height: members.height + GROUP_PAD * 2 + GROUP_LABEL,
  };
}

export function portPoint(box: Box, index: number, count: number, folded: boolean) {
  return { x: box.x + box.width, y: box.y + portMiddle(box, folded) + (index - (count - 1) / 2) * PORT_STEP };
}

const portMiddle = (box: Box, folded: boolean) => (folded ? box.height / 2 : (box.height + GROUP_LABEL) / 2);

export function inputPoint(box: Box) {
  return { x: box.x, y: box.y + box.height / 2 };
}

export interface GroupPort {
  type: WfnPortType;
  connected: boolean;
  armed: boolean;
}

export function GroupFrame(props: {
  group: CanvasGroup;
  box: Box;
  selected: boolean;
  ports: readonly GroupPort[];
  pictures: readonly string[];
  status?: WfnRunStatus | undefined;
  readOnly: boolean;
  fixed: boolean;
  onRename: (name: string) => void;
  onEndRename: () => void;
  onExpand: () => void;
  onSelect: () => void;
  onPortDown: (type: WfnPortType, event: PointerEvent) => void;
  onPortPress: (type: WfnPortType) => void;
}) {
  const { t } = useText();
  const name = () => props.group.name || t("workflow.canvas.group.defaultName");
  const portName = (type: WfnPortType) => t("workflow.node.port.output", { name: t(PORT_NAME[type]) });
  const portTop = (index: number) => {
    const count = props.ports.length;
    return `${portMiddle(props.box, props.group.folded) + (index - (count - 1) / 2) * PORT_STEP}px`;
  };
  return (
    <section
      class="wfn-frame"
      data-wfn-group={props.group.id}
      data-folded={props.group.folded ? "" : undefined}
      data-selected={props.selected ? "" : undefined}
      data-status={props.status}
      aria-label={name()}
      style={{
        left: `${props.box.x}px`,
        top: `${props.box.y}px`,
        width: `${props.box.width}px`,
        height: `${props.box.height}px`,
      }}
      onFocusIn={() => props.onSelect()}
      onDblClick={(event) => {
        if (
          props.group.folded &&
          !props.fixed &&
          !(event.target instanceof Element && event.target.closest("input, button"))
        )
          props.onExpand();
      }}
    >
      <div class="wfn-frame-label">
        <Layers class="wfn-frame-icon" aria-hidden="true" />
        <Input
          class="wfn-frame-name"
          value={props.group.name}
          placeholder={t("workflow.canvas.group.defaultName")}
          aria-label={t("workflow.canvas.group.name")}
          readonly={props.readOnly || props.fixed}
          spellcheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onValueChange={props.onRename}
          onBlur={() => props.onEndRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
          }}
        />
        <span class="wfn-frame-count">{t("workflow.canvas.group.count", { count: props.group.members.length })}</span>
      </div>
      <Show when={props.group.folded}>
        <div class="wfn-stack-pile" aria-hidden="true">
          <For each={props.pictures} fallback={<ImageIcon class="wfn-stack-glyph" />}>
            {(url, index) => <img class="wfn-stack-picture" data-layer={index()} src={url} alt="" draggable={false} />}
          </For>
        </div>
      </Show>
      <For each={props.ports}>
        {(port, index) => (
          <span class="wfn-port-slot wfn-frame-port" data-side="out" style={{ top: portTop(index()) }}>
            <Button
              variant="ghost"
              size="icon-xs"
              class="wfn-port"
              data-connected={port.connected ? "" : undefined}
              data-armed={port.armed ? "" : undefined}
              aria-label={portName(port.type)}
              disabled={props.readOnly}
              onPointerDown={(event: PointerEvent) => props.onPortDown(port.type, event)}
              onClick={() => props.onPortPress(port.type)}
            >
              <PortIcon type={port.type} />
            </Button>
            <span class="wfn-port-chip" aria-hidden="true">
              {t(PORT_NAME[port.type])}
            </span>
          </span>
        )}
      </For>
    </section>
  );
}
