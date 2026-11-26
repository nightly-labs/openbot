import type { TeamPresenceMember } from "@openbot/contracts/ipc";
import { Button, LabelTooltipTrigger } from "@openbot/ui";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import { useText } from "../../text";
import { TeamPersonAvatar, teamMemberName, teamMemberSeed } from "../team/TeamPersonAvatar";
import { Hint, type WfnPoint } from "./workflow-board";

export interface WorkflowPeerSpot {
  at: WfnPoint | undefined;
  selected: string | undefined;
}

export interface WorkflowOwnSpot {
  at: WfnPoint | null;
  selected: string | null;
}

export interface WorkflowPresence {
  self: string | null;
  members: readonly TeamPresenceMember[];
  spots: Readonly<Record<string, WorkflowPeerSpot>>;
}

export interface WorkflowPeer {
  member: TeamPresenceMember;
  name: string;
  color: string;
}

export interface WorkflowCursorRoom {
  right: number;
  bottom: number;
}

export const WORKFLOW_PRESENCE_FEED_INTERVAL = 50;

const CURSOR_NAME_LEFT = 8;
const CURSOR_NAME_TOP = 17;
const CURSOR_EDGE_GAP = 4;

export function peersOf(
  presence: Pick<WorkflowPresence, "self" | "members">,
  previous: readonly WorkflowPeer[] = [],
): readonly WorkflowPeer[] {
  const known = new Map(previous.map((peer) => [peer.member, peer]));
  const next = presence.members
    .filter((member) => member.online && !member.disabled && member.id !== presence.self)
    .map(
      (member) =>
        known.get(member) ?? {
          member,
          name: teamMemberName(member),
          color: avatarHeadColor(teamMemberSeed(member), null),
        },
    );
  const unchanged = next.length === previous.length && next.every((peer, index) => peer === previous[index]);
  return unchanged ? previous : next;
}

function Cursor(props: {
  name: string;
  color: string;
  at: WfnPoint;
  glide: number;
  ease?: string | undefined;
  leaving?: boolean | undefined;
  room: (at: WfnPoint) => WorkflowCursorRoom;
}) {
  let nameElement: HTMLSpanElement | undefined;
  const [nameSize, setNameSize] = createSignal({ width: 0, height: 0 });
  onSettled(() => {
    if (nameElement) setNameSize({ width: nameElement.offsetWidth, height: nameElement.offsetHeight });
  });
  const flip = createMemo(() => {
    const room = props.room(props.at);
    const size = nameSize();
    return {
      x: room.right < CURSOR_NAME_LEFT + size.width + CURSOR_EDGE_GAP,
      y: room.bottom < CURSOR_NAME_TOP + size.height + CURSOR_EDGE_GAP,
    };
  });
  return (
    <div
      class="wfn-peer-cursor"
      data-leaving={props.leaving ? "" : undefined}
      data-flip-x={flip().x ? "" : undefined}
      data-flip-y={flip().y ? "" : undefined}
      style={{
        "--wfn-peer": props.color,
        "--wfn-peer-feed": `${props.glide}ms`,
        "--wfn-peer-ease": props.ease,
        translate: `${props.at.x}px ${props.at.y}px`,
      }}
      aria-hidden="true"
    >
      <svg class="wfn-peer-arrow" viewBox="0 0 19 20" aria-hidden="true">
        <path d="M3.41 2.75 15.59 9.25Q17 10 15.45 10.39L9.78 11.81Q9 12 8.6 12.69L6.31 16.62Q5.5 18 5.16 16.44L2.34 3.56Q2 2 3.41 2.75Z" />
      </svg>
      <span ref={nameElement} class="wfn-peer-name">
        {props.name}
      </span>
    </div>
  );
}

export function PeerCursors(props: {
  peers: readonly WorkflowPeer[];
  spots: Readonly<Record<string, WorkflowPeerSpot>>;
  room: (at: WfnPoint) => WorkflowCursorRoom;
}) {
  return (
    <For each={props.peers}>
      {(peer) => (
        <Show when={props.spots[peer.member.id]?.at}>
          {(at) => (
            <Cursor
              name={peer.name}
              color={peer.color}
              at={at()}
              glide={WORKFLOW_PRESENCE_FEED_INTERVAL}
              room={props.room}
            />
          )}
        </Show>
      )}
    </For>
  );
}

export interface WorkflowBuilderSpot {
  name: string;
  color: string;
  at: WfnPoint;
  on: string | undefined;
  leaving: boolean;
}

export function BuilderCursor(props: {
  spot: WorkflowBuilderSpot;
  glide: number;
  room: (at: WfnPoint) => WorkflowCursorRoom;
}) {
  return (
    <Cursor
      name={props.spot.name}
      color={props.spot.color}
      at={props.spot.at}
      glide={props.glide}
      ease="var(--openbot-ease-in-out)"
      leaving={props.spot.leaving}
      room={props.room}
    />
  );
}

export function PresenceBar(props: {
  self: TeamPresenceMember | undefined;
  peers: readonly WorkflowPeer[];
  following: string | undefined;
  onFollow: (peer: WorkflowPeer) => void;
}) {
  const { t } = useText();
  return (
    <div class="wfn-hud wfn-hud-presence" role="toolbar" aria-label={t("workflow.canvas.presence.label")}>
      <For each={props.peers}>
        {(peer) => (
          <Hint label={peer.name} placement="bottom">
            <LabelTooltipTrigger
              as={Button}
              variant="ghost"
              size="icon-sm"
              class="wfn-hud-button wfn-presence-person"
              style={{ "--wfn-peer": peer.color }}
              aria-label={t("workflow.canvas.presence.follow", { name: peer.name })}
              aria-pressed={props.following === peer.member.id ? "true" : "false"}
              onClick={() => props.onFollow(peer)}
            >
              <TeamPersonAvatar member={peer.member} />
            </LabelTooltipTrigger>
          </Hint>
        )}
      </For>
      <Show when={props.self}>
        {(self) => (
          <span
            class="wfn-presence-person wfn-presence-self"
            style={{ "--wfn-peer": avatarHeadColor(teamMemberSeed(self()), null) }}
            role="img"
            aria-label={t("workflow.canvas.presence.you", { name: teamMemberName(self()) })}
          >
            <TeamPersonAvatar member={self()} />
          </span>
        )}
      </Show>
    </div>
  );
}

export function FollowFrame(props: { peer: WorkflowPeer }) {
  const { t } = useText();
  return (
    <div class="wfn-follow-frame" style={{ "--wfn-peer": props.peer.color }} role="status">
      <span class="wfn-follow-name">{t("workflow.canvas.presence.following", { name: props.peer.name })}</span>
    </div>
  );
}
