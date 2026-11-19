import { View } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";

const BADGE_RATIO = 16 / 36;
const MARK_RATIO = 10 / 16;
const BADGE_OFFSET = -2;

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
        color={agent.avatarColor}
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
