// @vitest-environment node
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSummary, BrowseWorkingDirectoryInput } from "@openbot/contracts/ipc";
import { decodeHostDirectory, parseBrowseWorkingDirectory } from "@openbot/contracts/ipc";
import { AGENT_WORKING_DIRECTORY_ROUTES as routes } from "@openbot/contracts/team-protocol/agent-working-directory-v1";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import { AgentWorkingDirectory } from "./agent-working-directory";
import { createAgents, createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

// Failure modes: a member browses host paths; absent capability permits access; directory pages
// expose file contents; file-only pages scan without a bound; symlinks save an unresolved path;
// missing paths expose private I/O errors.
afterEach(stopTeamApiFixtures);
it("allows only administrators to browse bounded directory pages", async () => {
  const fixture = await createTeamApiFixture("working-directory", { configure: true });
  const root = fixture.root;
  const folder = join(root, "repository");
  await mkdir(folder);
  for (let index = 0; index < 102; index++) await mkdir(join(folder, `folder-${index}`));
  await mkdir(join(folder, ".hidden"));
  await writeFile(join(folder, "secret.txt"), "never send this");
  await symlink(folder, join(root, "link"));
  const agent: AgentSummary = {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
    threadId: null,
    workspacePath: folder,
    preview: "",
    updatedAt: null,
  };
  const hidden: AgentSummary = { ...agent, id: "hidden", provider: "opencode" };
  let updates = 0;
  const directory = new AgentWorkingDirectory({
    listAgents: () => [agent, hidden],
    workingDirectoryBusy: () => false,
    setWorkingDirectory: (_agentId, path) =>
      Effect.sync(() => {
        updates++;
        if (path === null) delete agent.workingDirectory;
        else agent.workingDirectory = path;
        return agent;
      }),
  });
  const { base } = await fixture.start({
    agents: createAgents({ listAgents: () => [agent, hidden] }),
    admin: { workingDirectory: directory },
  });
  const headers = {
    Authorization: `Bearer ${await fixture.signIn()}`,
    "OpenBot-Protocol-Version": "3",
    "OpenBot-Capabilities": "agent-working-directory-v1",
    "Content-Type": "application/json",
  };
  const invite = await Effect.runPromise(fixture.store.createInvite("member"));
  const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "Member", "member password"));
  const post = (body: BrowseWorkingDirectoryInput, requestHeaders = headers) =>
    fetch(`${base}${routes.browse}`, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
  const body = { agentId: "chief", path: join(root, "link"), showHidden: false, offset: 0 };
  expect((await post(body, { ...headers, Authorization: `Bearer ${member.sessionToken}` })).status).toBe(403);
  expect((await post(body, { ...headers, "OpenBot-Capabilities": "" })).status).toBe(400);
  const first = await post(body);
  expect(first.status).toBe(200);
  const page = decodeHostDirectory(await first.json());
  expect(page.path).toBe(await realpath(folder));
  expect(page.entries).toHaveLength(100);
  expect(page.entries.some((entry) => entry.name === "secret.txt" || entry.name === ".hidden")).toBe(false);
  const second = decodeHostDirectory(await (await post({ ...body, offset: page.nextOffset ?? 0 })).json());
  expect(second.entries).toHaveLength(2);
  expect(new Set([...page.entries, ...second.entries].map((entry) => entry.path)).size).toBe(102);
  expect([...page.entries, ...second.entries].some((entry) => entry.name === "secret.txt")).toBe(false);
  expect((await post({ ...body, offset: 100_001 })).status).toBe(400);
  expect(() => parseBrowseWorkingDirectory({ ...body, offset: 100_001 })).toThrow();
  const hiddenResponse = await post({ ...body, agentId: "hidden" });
  expect(hiddenResponse.status).toBe(404);
  const update = (agentId: string, requestHeaders = headers) =>
    fetch(`${base}${routes.update}`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ agentId, path: folder }),
    });
  expect((await update("chief", { ...headers, Authorization: `Bearer ${member.sessionToken}` })).status).toBe(403);
  expect((await update("hidden")).status).toBe(404);
  expect(updates).toBe(0);
  expect((await update("chief")).status).toBe(200);
  expect(updates).toBe(1);
  const hiddenPages = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = decodeHostDirectory(await (await post({ ...body, showHidden: true, offset })).json());
    hiddenPages.push(...page.entries);
    offset = page.nextOffset;
  }
  expect(hiddenPages.some((entry) => entry.name === ".hidden")).toBe(true);
  const missing = await post({ ...body, path: join(root, "private-missing") });
  expect(missing.status).toBe(400);
  expect(await missing.text()).not.toContain(root);
  const filesOnly = join(root, "files-only");
  await mkdir(filesOnly);
  for (let index = 0; index < 1_001; index++) await writeFile(join(filesOnly, `file-${index}`), "private");
  const filePage = decodeHostDirectory(await (await post({ ...body, path: filesOnly })).json());
  expect(filePage.entries).toEqual([]);
  expect(filePage.nextOffset).toBe(1_000);
  const lastFilePage = decodeHostDirectory(
    await (await post({ ...body, path: filesOnly, offset: filePage.nextOffset ?? 0 })).json(),
  );
  expect(lastFilePage.entries).toEqual([]);
  expect(lastFilePage.nextOffset).toBeNull();
});
