/**
 * Other people on the same canvas: a cursor with a name in the colour of each person's avatar, a ring
 * on the node that the person selected, and their avatars in the top bar. A press on an avatar moves
 * the camera to that person's cursor. The host gives the places from its presence feed.
 */

import type { TeamPresenceMember } from "@openbot/contracts/ipc";
import { Button, LabelTooltipTrigger } from "@openbot/ui";
import { For, Show } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import { useText } from "../../text";
import { TeamPersonAvatar, teamMemberName, teamMemberSeed } from "../team/TeamPersonAvatar";
import { Hint, type WfnPoint } from "./workflow-board";

/** Where another person is on the canvas, in world pixels. */
export interface WorkflowPeerSpot {
  at: WfnPoint;
  /** The node that the person selected. */
  selected: string | undefined;
}

export interface WorkflowPresence {
  /** The member id of the person who uses this canvas. */
  self: string;
  members: readonly TeamPresenceMember[];
  /** The place of each other person, by member id. A person with no place shows only in the top bar. */
  spots: Readonly<Record<string, WorkflowPeerSpot>>;
}

export interface WorkflowPeer {
  member: TeamPresenceMember;
  name: string;
  color: string;
}

/** The presence feed sends about 20 updates a second. The cursor eases between two updates. */
export const WORKFLOW_PRESENCE_FEED_INTERVAL = 50;

/** The other people who are online, each in the colour of their avatar. */
export function peersOf(presence: Pick<WorkflowPresence, "self" | "members">): readonly WorkflowPeer[] {
  return presence.members
    .filter((member) => member.online && !member.disabled && member.id !== presence.self)
    .map((member) => ({ member, name: teamMemberName(member), color: avatarHeadColor(teamMemberSeed(member), null) }));
}

/**
 * The cursors, in world pixels, at their screen size at every zoom: a soft arrow and the full name in
 * a pill under it. They take no pointer events.
 */
export function PeerCursors(props: {
  peers: readonly WorkflowPeer[];
  spots: Readonly<Record<string, WorkflowPeerSpot>>;
}) {
  return (
    <For each={props.peers}>
      {(peer) => (
        <Show when={props.spots[peer.member.id]}>
          {(spot) => (
            <div
              class="wfn-peer-cursor"
              style={{
                "--wfn-peer": peer.color,
                "--wfn-peer-feed": `${WORKFLOW_PRESENCE_FEED_INTERVAL}ms`,
                translate: `${spot().at.x}px ${spot().at.y}px`,
              }}
              aria-hidden="true"
            >
              <svg class="wfn-peer-arrow" viewBox="0 0 19 20" aria-hidden="true">
                <path d="M3.41 2.75 15.59 9.25Q17 10 15.45 10.39L9.78 11.81Q9 12 8.6 12.69L6.31 16.62Q5.5 18 5.16 16.44L2.34 3.56Q2 2 3.41 2.75Z" />
              </svg>
              <span class="wfn-peer-name">{peer.name}</span>
            </div>
          )}
        </Show>
      )}
    </For>
  );
}

/** The people on this canvas, next to the run controls. You come last. A click follows a person. */
export function PresenceBar(props: {
  self: TeamPresenceMember | undefined;
  peers: readonly WorkflowPeer[];
  /** The person whose cursor the camera follows, or `undefined`. */
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

/** While you follow a person, a frame in their colour holds the view, with their name at the top. */
export function FollowFrame(props: { peer: WorkflowPeer }) {
  const { t } = useText();
  return (
    <div class="wfn-follow-frame" style={{ "--wfn-peer": props.peer.color }} role="status">
      <span class="wfn-follow-name">{t("workflow.canvas.presence.following", { name: props.peer.name })}</span>
    </div>
  );
}
