import type { TeamPresenceMember } from "@openbot/contracts/ipc";
import type { AvatarMotion } from "../../bloub-avatar";
import { AgentAvatar } from "../agents/AgentAvatar";

export function TeamPersonAvatar(props: { member: TeamPresenceMember; large?: boolean; motion?: AvatarMotion }) {
  const avatarSeed = () => teamMemberSeed(props.member);

  return (
    <span class={["person-avatar", { large: Boolean(props.large) }]} aria-hidden="true">
      <AgentAvatar
        seed={avatarSeed()}
        url={props.member.avatarUrl}
        motion={props.motion ?? "idle"}
        class="person-avatar-generated"
      />
    </span>
  );
}

export function teamMemberSeed(member: TeamPresenceMember): string {
  return member.email ?? member.username ?? member.id;
}

export function teamMemberName(member: TeamPresenceMember): string {
  return member.name?.trim() || member.email || member.username;
}
