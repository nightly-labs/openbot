/**
 * Groups on the workflow canvas. A group is a frame around nodes, with a name and one output port for
 * each output type of its members. A line from that port stands for one line from each member, and
 * the lines from the members to one input draw as one line with a count. A group can collapse into a
 * stack card.
 *
 * The group is a view state: each member keeps the group id, the name and the collapsed state in its
 * fields. A run reads none of them, and a host keeps fields as they are.
 */

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

/** The fields of a member: the id of its group, the name of the group, and whether the group is collapsed. */
export const GROUP_FIELDS = { id: "group", name: "groupName", folded: "groupFolded" } as const;

export interface CanvasGroup {
  id: string;
  name: string;
  folded: boolean;
  /** The members on the canvas, in node order. A group has two or more. */
  members: readonly string[];
}

/** The room between the members and the frame, and the room above them for the name. */
export const GROUP_PAD = 28;
export const GROUP_LABEL = 32;
/** More room on the right of an open group, so its ports are clear of the output ports of its members. */
const PORT_ROOM = 40;
/** The size of a collapsed group: the stack card. */
export const STACK_SIZE = { width: 248, height: 216 } as const;
/** The distance between two output ports of a group. */
const PORT_STEP = 34;
/** The most pictures that a stack card shows. */
export const STACK_PICTURES = 3;
const PORT_ORDER: readonly WfnPortType[] = ["text", "image", "file"];

/** The output types that one or more members have, in port order: a group has one port for each. */
export const outputTypes = (outputs: readonly (readonly WfnPortType[])[]) =>
  PORT_ORDER.filter((type) => outputs.some((list) => list.includes(type)));

/** The groups of the nodes, from the fields of their members. A group with one member left is no group. */
export function groupsOf(ids: readonly string[], field: (id: string, key: string) => WfnFieldValue | undefined) {
  const found = new Map<string, CanvasGroup>();
  for (const id of ids) {
    const group = field(id, GROUP_FIELDS.id);
    if (typeof group !== "string" || group === "") continue;
    const entry = found.get(group);
    if (entry) {
      found.set(group, { ...entry, members: [...entry.members, id] });
      continue;
    }
    const name = field(id, GROUP_FIELDS.name);
    found.set(group, {
      id: group,
      name: typeof name === "string" ? name : "",
      folded: field(id, GROUP_FIELDS.folded) === true,
      members: [id],
    });
  }
  return [...found.values()].filter((group) => group.members.length > 1);
}

export const sameGroups = (one: readonly CanvasGroup[], other: readonly CanvasGroup[]) =>
  JSON.stringify(one) === JSON.stringify(other);

/** The fields that put nodes in a new group, collapsed or not. */
export function joinPatch(ids: readonly string[], name: string, folded = false): WfnFieldPatch {
  const id = `group-${crypto.randomUUID()}`;
  return Object.fromEntries(
    ids.map((member) => [
      member,
      { [GROUP_FIELDS.id]: id, [GROUP_FIELDS.name]: name, [GROUP_FIELDS.folded]: folded || undefined },
    ]),
  );
}

/** The fields that take nodes out of their group. */
export function leavePatch(ids: readonly string[]): WfnFieldPatch {
  return Object.fromEntries(
    ids.map((member) => [
      member,
      { [GROUP_FIELDS.id]: undefined, [GROUP_FIELDS.name]: undefined, [GROUP_FIELDS.folded]: undefined },
    ]),
  );
}

/** The fields that give each member of a group the same value of a group field. */
export function groupPatch(group: CanvasGroup, key: string, value: WfnFieldValue | undefined): WfnFieldPatch {
  return Object.fromEntries(group.members.map((member) => [member, { [key]: value }]));
}

/**
 * The fields of copied nodes, with a new id for each group, so that copies do not join the group of
 * the nodes they copy. A copy whose group has no other copy leaves the group.
 */
export function regroupCopies(fields: Record<string, WfnFields>): Record<string, WfnFields> {
  const counts = new Map<string, number>();
  for (const entry of Object.values(fields)) {
    const group = entry[GROUP_FIELDS.id];
    if (typeof group === "string") counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const fresh = new Map([...counts.keys()].map((group) => [group, `group-${crypto.randomUUID()}`]));
  return Object.fromEntries(
    Object.entries(fields).map(([id, entry]) => {
      const group = entry[GROUP_FIELDS.id];
      if (typeof group !== "string") return [id, entry];
      const { [GROUP_FIELDS.id]: _id, [GROUP_FIELDS.name]: _name, [GROUP_FIELDS.folded]: _folded, ...rest } = entry;
      const next = fresh.get(group);
      return [id, (counts.get(group) ?? 0) > 1 && next ? { ...entry, [GROUP_FIELDS.id]: next } : rest];
    }),
  );
}

/** The box of a group around the boxes of its members: the frame, or the stack card when collapsed. */
export function frameBox(group: CanvasGroup, members: Box): Box {
  if (group.folded) return { x: members.x, y: members.y, ...STACK_SIZE };
  return {
    x: members.x - GROUP_PAD,
    y: members.y - GROUP_PAD - GROUP_LABEL,
    width: members.width + GROUP_PAD * 2 + PORT_ROOM,
    height: members.height + GROUP_PAD * 2 + GROUP_LABEL,
  };
}

/** The world point of an output port of a group: on the right side, the ports stacked around the middle. */
export function portPoint(box: Box, index: number, count: number, folded: boolean) {
  return { x: box.x + box.width, y: box.y + portMiddle(box, folded) + (index - (count - 1) / 2) * PORT_STEP };
}

/** The height of the ports of a group: the middle of its members, under the name; or of the stack card. */
const portMiddle = (box: Box, folded: boolean) => (folded ? box.height / 2 : (box.height + GROUP_LABEL) / 2);

/** Where the lines from outside go into a collapsed group: the middle of the left side. */
export function inputPoint(box: Box) {
  return { x: box.x, y: box.y + box.height / 2 };
}

export interface GroupPort {
  type: WfnPortType;
  connected: boolean;
  armed: boolean;
}

/** The frame of a group, or its stack card when it is collapsed. */
export function GroupFrame(props: {
  group: CanvasGroup;
  box: Box;
  selected: boolean;
  ports: readonly GroupPort[];
  /** Up to three pictures of the members, for the stack card. */
  pictures: readonly string[];
  /** The run state of the hidden members of a collapsed group: failed, approval or running. */
  status?: WfnRunStatus | undefined;
  readOnly: boolean;
  onRename: (name: string) => void;
  onEndRename: () => void;
  onExpand: () => void;
  /** The focus went into the frame from the keyboard: select the members. */
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
        if (props.group.folded && !(event.target instanceof Element && event.target.closest("input, button")))
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
          readonly={props.readOnly}
          spellcheck={false}
          // A new name replaces the old one, as in a rename.
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
