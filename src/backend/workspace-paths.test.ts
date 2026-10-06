import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { listWorkspaceDirectory, rebaseLegacyWorkspacePath, WorkspacePathRefused } from "./workspace-paths";

const AGENT_ID = "agent-6d3e8b17-9c04-4f21-8a55-1b2c3d4e5f60";
const LEGACY_ID = "bot-6d3e8b17-9c04-4f21-8a55-1b2c3d4e5f60";

describe("rebaseLegacyWorkspacePath", () => {
  it("finds a file the workspace move left on the other side of the rename", () => {
    const current = `/Users/dev/OpenBot/Agents/${AGENT_ID}`;
    const legacy = `/Users/dev/OpenBot/Bots/${LEGACY_ID}`;

    // The provider keeps its own transcript, and migration v13 cannot reach into it, so a resumed thread
    // still hands back the path it wrote before the workspace moved.
    expect(rebaseLegacyWorkspacePath(current, AGENT_ID, `${legacy}/app/page.tsx`)).toBe(`${current}/app/page.tsx`);
    // And the move itself gives up on EXDEV, leaving the agent in the old directory while v13 has already
    // rewritten the paths in its stored messages to the new one.
    expect(rebaseLegacyWorkspacePath(legacy, AGENT_ID, `${current}/app/page.tsx`)).toBe(`${legacy}/app/page.tsx`);

    // Neither direction is a way out of the workspace, and neither applies to a path that was never one.
    expect(rebaseLegacyWorkspacePath(current, AGENT_ID, "/Users/dev/OpenBot/Bots/secret.env")).toBeNull();
    expect(rebaseLegacyWorkspacePath(current, AGENT_ID, `${legacy}/../../secret.env`)).toBeNull();
    expect(rebaseLegacyWorkspacePath(`/Users/dev/code/${AGENT_ID}`, AGENT_ID, `${legacy}/app/page.tsx`)).toBeNull();
  });
});

describe("listWorkspaceDirectory", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-workspace-list-")));
    roots.push(root);
    const workspacePath = join(root, "workspace");
    await mkdir(join(workspacePath, "research", "eyeliner"), { recursive: true });
    await writeFile(join(workspacePath, "research", "eyeliner", "brief.md"), "# Brief");
    await mkdir(join(root, "private"));
    await writeFile(join(root, "private", "secret.env"), "TOKEN=1");
    // A link out of the workspace must not show the remote member what is behind it.
    await symlink(join(root, "private"), join(workspacePath, "research", "eyeliner", "outside"));
    return { id: AGENT_ID, workspacePath };
  }

  async function refusal(effect: Effect.Effect<unknown, { cause: unknown }>) {
    const { cause } = await Effect.runPromise(Effect.flip(effect));
    if (!(cause instanceof WorkspacePathRefused)) throw cause;
    return cause;
  }

  it("lists a folder chip and keeps a remote caller inside the workspace", async () => {
    const agent = await fixture();

    const listing = await Effect.runPromise(listWorkspaceDirectory(agent, "research/eyeliner/"));
    expect(listing.path).toBe("research/eyeliner");
    expect(listing.parentPath).toBe("research");
    expect(listing.entries.map(({ name, path, kind }) => ({ name, path, kind }))).toEqual([
      { name: "brief.md", path: "research/eyeliner/brief.md", kind: "file" },
    ]);

    const outside = await refusal(listWorkspaceDirectory(agent, "../private"));
    expect(outside.reason).toBe("outside");
    const linked = await refusal(listWorkspaceDirectory(agent, "research/eyeliner/outside"));
    expect(linked.reason).toBe("outside");
  });

  it("names the path and the workspace when nothing is there", async () => {
    const agent = await fixture();

    const missing = await refusal(listWorkspaceDirectory(agent, "research/lipstick/"));
    expect(missing.reason).toBe("missing");
    expect(missing.message).toContain("research/lipstick/");
    expect(missing.message).toContain(agent.workspacePath);
  });
});
