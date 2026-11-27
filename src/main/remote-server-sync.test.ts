import type { SyncCollectionSpec } from "@openbot/contracts/team-protocol/sync-collections";
import { describe, expect, it } from "vitest";
import { withRemotePictureUrls } from "./remote-server-sync";
import { parseRemoteAvatarUrl } from "./remote-server-urls";

const version = "0b6f0c52-7a4e-4c1f-9d2b-3f6a8e1c5d70";

function specOf<Entity>(decode: (row: unknown) => Entity): SyncCollectionSpec<Entity> {
  return { name: "agents", key: () => "key", decode };
}

describe("synced pictures", () => {
  it("points a synced agent photo at the joined server", () => {
    const agent = { id: "agent-1", avatarUrl: `openbot-avatar://agent/agent-1?v=${version}&type=image%2Fpng` };
    const decoded = withRemotePictureUrls(
      specOf(() => agent),
      "server-1",
    ).decode({});
    expect(decoded.avatarUrl).toBeDefined();
    expect(parseRemoteAvatarUrl(decoded.avatarUrl ?? "")).toEqual({
      kind: "agent",
      serverId: "server-1",
      id: "agent-1",
      version,
    });
  });

  it("points a synced channel picture at the joined server", () => {
    const channel = { id: "channel-1", imageUrl: `openbot-avatar://channel/channel-1?v=${version}&type=image%2Fpng` };
    const decoded = withRemotePictureUrls(
      specOf(() => channel),
      "server-1",
    ).decode({});
    expect(parseRemoteAvatarUrl(decoded.imageUrl ?? "")).toEqual({
      kind: "channel",
      serverId: "server-1",
      id: "channel-1",
      version,
    });
  });

  it("leaves an agent without a photo alone", () => {
    const agent = { id: "agent-1", avatarUrl: null };
    expect(
      withRemotePictureUrls(
        specOf(() => agent),
        "server-1",
      ).decode({}),
    ).toEqual(agent);
  });
});
