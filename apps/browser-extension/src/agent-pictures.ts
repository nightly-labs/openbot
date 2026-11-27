import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";

const HOST_PICTURE_SCHEME = "openbot-avatar:";
const PARALLEL_READS = 2;

export interface AgentPicture {
  source: string;
  url: string;
}

interface PictureRead {
  key: string;
  agentId: string;
  source: string;
  version: string;
}

function pictureVersion(source: string): string | null {
  if (!source.startsWith(HOST_PICTURE_SCHEME)) return null;
  try {
    return new URL(source).searchParams.get("v");
  } catch {
    return null;
  }
}

function decodePicture(value: unknown): string {
  if (
    !isDynamicRecord(value) ||
    !isString(value.mimeType) ||
    !isAvatarMimeType(value.mimeType) ||
    !isString(value.base64)
  )
    throw new Error(currentText().t("extension.connection.requestFailed"));
  return `data:${value.mimeType};base64,${value.base64}`;
}

export function createAgentPictures(request: TeamApiRequest, show: (agentId: string, picture: AgentPicture) => void) {
  const started = new Set<string>();
  const wanted = new Map<string, string | null>();
  const queue: PictureRead[] = [];
  let reads = 0;
  let disposed = false;

  function readNext(): void {
    while (!disposed && reads < PARALLEL_READS) {
      const next = queue.shift();
      if (!next) return;
      reads += 1;
      const path = `${TEAM_API_ROUTES.agent.avatar(next.agentId)}?${new URLSearchParams({ v: next.version })}`;
      void request("GET", path, decodePicture)
        .then(
          (url) => {
            if (!disposed && wanted.get(next.agentId) === next.source) show(next.agentId, { source: next.source, url });
          },
          () => started.delete(next.key),
        )
        .finally(() => {
          reads -= 1;
          readNext();
        });
    }
  }

  return {
    load(agents: readonly ClientAgentSummary[]): void {
      for (const agent of agents) {
        const source = agent.avatarUrl;
        wanted.set(agent.id, source);
        const version = source ? pictureVersion(source) : null;
        if (!source || !version) continue;
        const key = `${agent.id} ${source}`;
        if (started.has(key)) continue;
        started.add(key);
        queue.push({ key, agentId: agent.id, source, version });
      }
      readNext();
    },
    dispose(): void {
      disposed = true;
      queue.length = 0;
    },
  };
}
