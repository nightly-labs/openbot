import type { AvatarHue, ChannelIcon, ChannelIconName, ChannelMember } from "@openbot/contracts/ipc";
import { UsersRound } from "@openbot/ui";
import { avatarHueSwatch } from "@openbot/ui/bloub-avatar";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { ComposerAgent } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import { CHANNEL_ICONS, knownChannelIcon } from "./channel-icons";

const ROW_LIMIT = 3;
const CLUSTER_CELLS = 4;

interface ChannelAvatarProps {
  members: ChannelMember[];
  agents: readonly ComposerAgent[];
  layout?: "row" | "cluster";
  icon?: ChannelIcon | null | undefined;
  imageUrl?: string | null | undefined;
}

export function ChannelAvatar(props: ChannelAvatarProps) {
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
  const members = createMemo(() => {
    const seen = new Set<string>();
    return props.members.filter((member) => !seen.has(member.agentId) && Boolean(seen.add(member.agentId)));
  });
  const cluster = () => props.layout === "cluster";
  const shown = () => {
    if (!cluster()) return members().slice(0, ROW_LIMIT);
    if (members().length <= CLUSTER_CELLS) return members();
    const countWithThreeFaces = members().length - (CLUSTER_CELLS - 1);
    return members().slice(0, countWithThreeFaces >= 10 ? CLUSTER_CELLS - 2 : CLUSTER_CELLS - 1);
  };
  const hidden = () => members().length - shown().length;
  return (
    <span class={["channel-avatar", { "channel-avatar-cluster": cluster() }]} aria-hidden="true">
      <Show when={members().length} fallback={<UsersRound />}>
        <For each={shown()} keyed={(member) => member.agentId}>
          {(member) => {
            const agent = createMemo(() => agentFor(member()));
            return <AgentAvatar agent={agent()} seed={agent()?.avatarSeed ?? member().agentId} />;
          }}
        </For>
        <Show when={cluster() && hidden() > 0}>
          <span class="channel-avatar-count">+{hidden()}</span>
        </Show>
      </Show>
    </span>
  );
}
