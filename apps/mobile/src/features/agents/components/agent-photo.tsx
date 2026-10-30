import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { type ReactNode, useId, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from "react-native-svg";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { DISCONNECTED_APPEARANCE } from "@/features/workspace/components/use-connection-appearance";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { savedAgentAvatar } from "@/features/workspace/model/agent-avatar-cache";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";

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
  const workspace = useMobileWorkspaceReader();
  const queryScope = useQueryScope();
  const avatarUrl = useMobileWorkspaceSelector((current) =>
    imageUrl === undefined
      ? current.agents.find((candidate) => candidate.id === agentId && candidate.serverId === serverId)?.avatarUrl
      : undefined,
  );
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const photo = useQuery({
    queryKey: queryKeys.agentAvatar(queryScope, serverId, agentId, avatarUrl),
    enabled: imageUrl === undefined && Boolean(avatarUrl && agentId && serverId && online),
    queryFn: () => {
      if (!agentId || !serverId || !avatarUrl) throw new Error("The agent avatar is unavailable.");
      return workspace().loadAgentAvatar(agentId, avatarUrl, serverId);
    },
    // A saved photo shows at once, also before the server connects.
    initialData: () =>
      agentId && serverId && avatarUrl ? (savedAgentAvatar(serverId, agentId, avatarUrl) ?? undefined) : undefined,
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
