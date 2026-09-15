import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { type ReactNode, useId, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from "react-native-svg";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { DISCONNECTED_APPEARANCE } from "@/features/workspace/components/use-connection-appearance";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export interface AgentPhotoProps {
  agentId?: string;
  serverId?: string;
  imageUrl?: string | null;
  disconnected?: boolean;
}

export function AgentPhoto({
  agentId,
  serverId,
  imageUrl,
  disconnected = false,
  size,
  children,
}: AgentPhotoProps & { size: number; children: ReactNode }) {
  const { agents, servers, loadAgentAvatar } = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const agent = agents.find((candidate) => candidate.id === agentId && candidate.serverId === serverId);
  const avatarUrl = agent?.avatarUrl;
  const photo = useQuery({
    queryKey: ["agent-avatar", session?.apiUrl, session?.user.id, sessionScope, serverId, agentId, avatarUrl],
    enabled:
      imageUrl === undefined &&
      Boolean(
        avatarUrl &&
          agentId &&
          serverId &&
          servers.some((server) => server.id === serverId && server.state === "online"),
      ),
    queryFn: () => {
      if (!agentId || !serverId || !avatarUrl) throw new Error("The agent avatar is unavailable.");
      return loadAgentAvatar(agentId, avatarUrl, serverId);
    },
    staleTime: Infinity,
  });
  const uri = imageUrl === undefined ? photo.data : imageUrl;
  const [failed, setFailed] = useState<string | null>(null);
  const filterId = `photo-offline-${useId().replaceAll(":", "")}`;
  return uri && uri !== failed ? (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      <Image
        source={{ uri }}
        contentFit="cover"
        recyclingKey={uri}
        style={{ width: size, height: size, opacity: disconnected ? 0 : 1 }}
        onError={() => setFailed(uri)}
      />
      {/* iOS does not support the native saturation style. Keep Expo's error handling
          and use the same SVG filter as generated avatars for the offline image. */}
      {disconnected ? (
        <Svg
          width={size}
          height={size}
          pointerEvents="none"
          style={{ position: "absolute" }}
          opacity={DISCONNECTED_APPEARANCE.opacity}
        >
          <Defs>
            <Filter id={filterId}>
              <FeColorMatrix type="saturate" values={[DISCONNECTED_APPEARANCE.saturation]} />
            </Filter>
          </Defs>
          <SvgImage
            href={{ uri }}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid slice"
            filter={`url(#${filterId})`}
          />
        </Svg>
      ) : null}
    </View>
  ) : (
    children
  );
}
