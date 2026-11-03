/**
 * The stack of member avatars. It takes the agents to look members up in rather than reading the
 * Agents context: the sidebar renders channel rows from the agent list it is already given, and a
 * row that reached for a context of its own would be the one row in the list that cannot render
 * without it.
 *
 * Two layouts: a row of overlapping avatars, and the cluster the sidebar uses, which holds the
 * members in the square one agent avatar occupies. The cluster keeps a channel row the same shape
 * as the agent rows around it, and it counts the members it cannot show.
 *
 * A channel can have its own picture instead: an uploaded image, or an icon on a colour. The
 * picture is square, so a channel does not look like an agent, and it takes the place the faces
 * would take.
 */

import type { AvatarHue, ChannelIcon, ChannelMember } from "@openbot/contracts/ipc";
import { UsersRound } from "@openbot/ui";
import { avatarHueSwatch } from "@openbot/ui/bloub-avatar";
import { createSignal, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import { CHANNEL_ICONS, type ChannelIconName, knownChannelIcon } from "./channel-icons";

const ROW_LIMIT = 3;
const CLUSTER_CELLS = 4;

interface ChannelAvatarProps {
  members: ChannelMember[];
  agents: AgentProfile[];
  layout?: "row" | "cluster";
  icon?: ChannelIcon | null | undefined;
  imageUrl?: string | null | undefined;
}

export function ChannelAvatar(props: ChannelAvatarProps) {
  /* An image that does not load, such as a file removed by hand, shows the icon or the faces. */
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const imageUrl = () => (props.imageUrl && props.imageUrl !== failedUrl() ? props.imageUrl : null);
  const icon = () => knownChannelIcon(props.icon);
  const hasPicture = () => Boolean(imageUrl() || icon());
  return (
    <Show when={hasPicture()} fallback={<MemberFaces {...props} />}>
      <span
        class={["channel-avatar", "channel-avatar-picture", { "channel-avatar-cluster": props.layout === "cluster" }]}
        aria-hidden="true"
      >
        <Show when={imageUrl()} fallback={<Show when={icon()}>{(choice) => <ChannelIconTile {...choice()} />}</Show>}>
          {(url) => (
            <img
              class="channel-picture channel-picture-image"
              src={url()}
              alt=""
              draggable={false}
              onError={() => setFailedUrl(url())}
            />
          )}
        </Show>
      </span>
    </Show>
  );
}

/** An icon on the channel colour. The editor draws its choices with it too. */
export function ChannelIconTile(props: { name: ChannelIconName; hue: AvatarHue }) {
  return (
    <span class="channel-picture" style={{ "--channel-picture-hue": avatarHueSwatch(props.hue) }} aria-hidden="true">
      <Show when={props.name} keyed>
        {(name) => {
          const Glyph = CHANNEL_ICONS[name].component;
          return <Glyph aria-hidden="true" />;
        }}
      </Show>
    </span>
  );
}

function MemberFaces(props: ChannelAvatarProps) {
  const agentFor = (member: ChannelMember) => props.agents.find((agent) => agent.id === member.agentId);
  const cluster = () => props.layout === "cluster";
  /* The last cell of a full cluster is the count, so a fifth member costs a face rather than
   * hiding without a trace. Four members still get four faces. A count of two digits is wider than
   * a cell, so it takes the whole bottom row, under two faces. */
  const shown = () => {
    if (!cluster()) return props.members.slice(0, ROW_LIMIT);
    if (props.members.length <= CLUSTER_CELLS) return props.members;
    const countWithThreeFaces = props.members.length - (CLUSTER_CELLS - 1);
    return props.members.slice(0, countWithThreeFaces >= 10 ? CLUSTER_CELLS - 2 : CLUSTER_CELLS - 1);
  };
  const hidden = () => props.members.length - shown().length;
  return (
    <span class={["channel-avatar", { "channel-avatar-cluster": cluster() }]} aria-hidden="true">
      <Show when={props.members.length} fallback={<UsersRound />}>
        <For each={shown()}>
          {(member) => <AgentAvatar agent={agentFor(member)} seed={agentFor(member)?.avatarSeed ?? member.agentId} />}
        </For>
        <Show when={cluster() && hidden() > 0}>
          <span class="channel-avatar-count">+{hidden()}</span>
        </Show>
      </Show>
    </span>
  );
}
