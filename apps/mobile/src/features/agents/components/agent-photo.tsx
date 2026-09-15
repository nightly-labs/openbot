import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { type ReactNode, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export interface AgentPhotoProps {
  agentId?: string;
  serverId?: string;
  imageUrl?: string | null;
}

export function AgentPhoto({
  agentId,
  serverId,
  imageUrl,
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
  return uri && uri !== failed ? (
    <Image
      source={{ uri }}
      contentFit="cover"
      recyclingKey={uri}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      onError={() => setFailed(uri)}
    />
  ) : (
    children
  );
}
