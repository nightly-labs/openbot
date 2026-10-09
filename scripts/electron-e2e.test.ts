// Failure modes: provider tool replies must precede completion; child work must reach the parent;
// an interrupted provider turn must not publish a final answer. Uses the real AgentService boundary.
import { chmod, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentService } from "../src/backend/agent-service";
import {
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "../src/backend/agent-service-test-harness";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { hostCases, liveCases, releaseCoverage, scriptedCases } from "../tests/e2e/support/coverage";
import { prompt } from "../tests/e2e/support/scenario";

let fixtureRoot = "";
let service: AgentService | undefined;

afterEach(async () => {
  if (fixtureRoot) await stopAgentTestFixture(fixtureRoot, service ?? null);
  fixtureRoot = "";
  service = undefined;
  vi.unstubAllEnvs();
});

it("runs agent creation and delegated replies through the scripted CLI", async () => {
  const fixture = await startAgentTestFixture();
  fixtureRoot = fixture.root;
  const cli = resolve("tests/e2e/support/scripted-provider.ts");
  await chmod(cli, 0o755);
  vi.stubEnv("OPENBOT_CODEX_PATH", cli);
  vi.stubEnv("OPENBOT_E2E_PROTOCOL_STATE", join(fixtureRoot, "protocol"));
  const started = await startService(fixtureRoot);
  service = started.service;
  const parent = await runCauseEffect(started.store.getOrCreate("chief"));
  await runCauseEffect(
    service.sendMessage({
      agentId: parent.id,
      text: prompt({
        steps: [
          {
            kind: "tool",
            name: "create_agent",
            save: "child",
            args: {
              name: "Release child",
              description: "Test child",
              initialMessage: prompt({ reply: "Child ready" }),
            },
          },
          {
            kind: "tool",
            name: "send_message",
            args: { recipientAgentIds: ["$result:child.id"], text: prompt({ reply: "Verified child result" }) },
          },
        ],
        reply: "Parent dispatched",
      }),
    }),
  );
  await waitFor(async () => {
    if (!service) return false;
    return (await runCauseEffect(service.readConversation(parent.id))).messages.some((message) =>
      message.text.includes("Status: done\nResult: Verified child result"),
    );
  });
  const messages = (await runCauseEffect(service.readConversation(parent.id))).messages;
  expect(
    messages.filter((message) => message.text.includes("Status: done\nResult: Verified child result")),
  ).toHaveLength(1);
});

it("keeps interrupted work out of history and resumes the same thread", async () => {
  const fixture = await startAgentTestFixture();
  fixtureRoot = fixture.root;
  const cli = resolve("tests/e2e/support/scripted-provider.ts");
  await chmod(cli, 0o755);
  vi.stubEnv("OPENBOT_CODEX_PATH", cli);
  vi.stubEnv("OPENBOT_E2E_PROTOCOL_STATE", join(fixtureRoot, "protocol"));
  const started = await startService(fixtureRoot);
  service = started.service;
  const active = service;
  const agent = await runCauseEffect(started.store.getOrCreate("chief"));
  await runCauseEffect(
    active.sendMessage({
      agentId: agent.id,
      text: prompt({
        steps: [{ kind: "hold", key: "never-release" }],
        reply: "Must not appear",
      }),
    }),
  );
  await waitFor(async () => Boolean((await runCauseEffect(active.readConversation(agent.id))).activeTurnId));
  const before = await runCauseEffect(active.readConversation(agent.id));
  if (!before.activeTurnId) throw new Error("Missing active turn.");
  await runCauseEffect(active.interrupt(agent.id, before.activeTurnId));
  await waitFor(async () => (await runCauseEffect(active.readConversation(agent.id))).activeTurnId === null);
  await runCauseEffect(active.stop());
  const restarted = await startService(fixtureRoot);
  service = restarted.service;
  const resumed = service;
  await runCauseEffect(resumed.sendMessage({ agentId: agent.id, text: prompt({ reply: "After restart" }) }));
  await waitFor(async () =>
    (await runCauseEffect(resumed.readConversation(agent.id))).messages.some(
      (message) => message.text === "After restart",
    ),
  );
  const after = await runCauseEffect(resumed.readConversation(agent.id));
  expect(after.threadId).toBe(before.threadId);
  expect(after.messages.some((message) => message.text === "Must not appear")).toBe(false);
});

it("completes group delegation after the parent task resumes", async () => {
  const fixture = await startAgentTestFixture();
  fixtureRoot = fixture.root;
  const cli = resolve("tests/e2e/support/scripted-provider.ts");
  await chmod(cli, 0o755);
  vi.stubEnv("OPENBOT_CODEX_PATH", cli);
  vi.stubEnv("OPENBOT_E2E_PROTOCOL_STATE", join(fixtureRoot, "protocol"));
  const started = await startService(fixtureRoot);
  service = started.service;
  const lead = await runCauseEffect(started.store.getOrCreate("chief"));
  const child = await runCauseEffect(started.store.getOrCreate("worker"));
  const actor = { id: "release-user", name: "Release user" };
  await runCauseEffect(
    service.channels.command(
      {
        type: "save",
        channelId: "release-group",
        operationId: "create-group",
        draft: {
          name: "Release group",
          title: "",
          instructions: "",
          members: [{ agentId: lead.id }, { agentId: child.id }],
          leadAgentId: lead.id,
        },
      },
      actor,
    ),
  );
  await runCauseEffect(
    service.channels.command(
      {
        type: "send",
        channelId: "release-group",
        operationId: "send-task",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
        text: prompt({
          steps: [
            {
              kind: "tool",
              name: "channel_assign",
              args: {
                recipientAgentId: child.id,
                task: prompt({
                  steps: [{ kind: "tool", name: "channel_result", args: { text: "Group result 42" } }],
                  reply: "Finished",
                }),
                expectedResult: "Group result 42",
                resources: ["none"],
                sourceMessageIds: ["$result:context.task.requestMessageId"],
              },
            },
          ],
          reply: "Assigned",
        }),
      },
      actor,
    ),
  );
  const active = service;
  await vi
    .waitFor(
      () =>
        expect(
          active.channels.store
            .tasks("release-group")
            .map(({ ownerAgentId, state, error }) => ({ ownerAgentId, state, error })),
        ).toEqual([
          { ownerAgentId: lead.id, state: "completed", error: null },
          { ownerAgentId: child.id, state: "completed", error: null },
        ]),
      { timeout: 10_000 },
    )
    .catch(async (error) => {
      const detail = await readFile(join(fixtureRoot, "protocol/last-failure.txt"), "utf8").catch(
        () => "No provider error",
      );
      throw new Error(detail, { cause: error });
    });
  expect(active.channels.store.tasks("release-group")).toHaveLength(2);
  expect(
    active.channels.store.messages("release-group").some((message) => message.message.text === "Group result 42"),
  ).toBe(true);
});

it.each(["release", "scripted"] as const)("rejects missing, skipped, failed, and slow %s coverage", (suite) => {
  const complete = ["local", "host"].flatMap((mode) =>
    [...scriptedCases, ...(suite === "release" ? liveCases : []), ...(mode === "host" ? hostCases : [])].map((id) => ({
      mode,
      id,
      status: "passed",
    })),
  );
  expect(releaseCoverage(complete, 600_000, suite).passed).toBe(true);
  expect(releaseCoverage(complete.slice(1), 1, suite).passed).toBe(false);
  expect(
    releaseCoverage(
      complete.filter((entry) => entry.id !== "host-revoke"),
      1,
      suite,
    ).missing,
  ).toContain("host/host-revoke");
  for (const status of ["skipped", "failed", "timedOut", "interrupted"]) {
    expect(
      releaseCoverage(
        complete.map((entry, index) => (index === 0 ? { ...entry, status } : entry)),
        1,
        suite,
      ).passed,
    ).toBe(false);
  }
  expect(releaseCoverage(complete, 600_001, suite).passed).toBe(false);
});
