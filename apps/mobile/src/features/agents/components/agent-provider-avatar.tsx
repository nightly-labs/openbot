import { View } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";

/** The badge and its mark, as parts of the avatar. */
const BADGE_RATIO = 16 / 36;
const MARK_RATIO = 10 / 16;
/** How far the badge goes past the avatar edge. */
const BADGE_OFFSET = -2;

/**
 * The avatar of an agent with the mark of its provider in a badge at the bottom right. The badge has the
 * colour of a grouped row, so it cuts the avatar on that background. An agent on a provider that this
 * build does not know has no badge. It is an image: the row that holds it has the name.
 */
export function AgentProviderAvatar({ agent, size }: { agent: MobileAgent; size: number }) {
  const badge = Math.round(size * BADGE_RATIO);
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <BloubAvatarThumbnail
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={size}
      />
      {agent.provider ? (
        <View
          className="absolute items-center justify-center rounded-full bg-grouped"
          style={{ right: BADGE_OFFSET, bottom: BADGE_OFFSET, width: badge, height: badge }}
        >
          <ProviderMark provider={agent.provider} size={Math.round(badge * MARK_RATIO)} />
        </View>
      ) : null}
    </View>
  );
}
