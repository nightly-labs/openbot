import { describe, expect, it } from "vitest";
import { addRemotePreviewUrls, parseRemoteAvatarUrl } from "./remote-server-urls";

// The `openbot-remote-avatar:` protocol handler asks a joined server only for what this parser
// accepts. Any other form must answer 404 without a host request.
const version = "0b6f0c52-7a4e-4c1f-9d2b-3f6a8e1c5d70";

describe("remote avatar URLs", () => {
  it("names an agent avatar and a channel picture", () => {
    expect(parseRemoteAvatarUrl(`openbot-remote-avatar://server-1/agent-1?v=${version}`)).toEqual({
      kind: "agent",
      serverId: "server-1",
      id: "agent-1",
      version,
    });
    expect(
      parseRemoteAvatarUrl(`openbot-remote-avatar://server-1/channel/channel-1?v=${version}&type=image/png`),
    ).toEqual({ kind: "channel", serverId: "server-1", id: "channel-1", version });
  });

  it("refuses every other form", () => {
    for (const url of [
      `openbot-avatar://server-1/agent-1?v=${version}`,
      `https://server-1/agent-1?v=${version}`,
      "openbot-remote-avatar://server-1/agent-1",
      `openbot-remote-avatar://server-1/?v=${version}`,
      `openbot-remote-avatar://server-1/agent-1/extra?v=${version}`,
      `openbot-remote-avatar://server-1/folder/channel-1?v=${version}`,
      `openbot-remote-avatar://server-1/channel/channel-1/extra?v=${version}`,
      `openbot-remote-avatar://server-1/%E0%A4%A?v=${version}`,
      "not a url",
    ])
      expect(parseRemoteAvatarUrl(url)).toBeNull();
  });

  it("rewrites only the host's own channel picture URL of the same channel", () => {
    const source = `openbot-avatar://channel/channel-1?v=${version}&type=image%2Fpng`;
    const [kept, foreign, other] = addRemotePreviewUrls(
      [
        { id: "channel-1", imageUrl: source },
        { id: "channel-2", imageUrl: source },
        { id: "channel-3", imageUrl: `openbot-avatar://channel/channel-3/../secret?v=${version}&type=image%2Fpng` },
      ],
      "server-1",
    );
    const target = kept?.imageUrl ? parseRemoteAvatarUrl(kept.imageUrl) : null;
    expect(target).toEqual({ kind: "channel", serverId: "server-1", id: "channel-1", version });
    expect(foreign?.imageUrl).toBeNull();
    expect(other?.imageUrl).toBeNull();
  });
});
