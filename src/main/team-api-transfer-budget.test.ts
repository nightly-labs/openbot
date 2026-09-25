// @vitest-environment node

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { TEAM_PROTOCOL_V4 } from "@openbot/contracts/team-protocol/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../backend/agent-service";
import {
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "../backend/agent-service-test-harness";
import { createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

// Hard caps for what a remote member downloads for one conversation over the Team API at the
// current protocol, about 30% above the values measured when each cap was set. The rules are the
// ones in `src/backend/transfer-budget.test.ts`.
const BUDGETS = {
  /** Response bytes of the conversation route after two turns. */
  teamConversationBytes: 2_000,
  /** Response bytes of the first conversation page after two turns. */
  teamConversationPageBytes: 2_100,
};

const REPORT_PATH = resolve(import.meta.dirname, "../../.openbot-build/transfer-budget/team-api.json");

let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopTeamApiFixtures();
  await stopAgentTestFixture(root, service);
  service = null;
});

describe("Team API transfer budget", () => {
  it("keeps one conversation within its wire byte caps", async () => {
    const started = await startService(root, { provider: "codex" });
    service = started.service;
    for (const [index, text] of ["Summarize the week.", "Now list three risks."].entries()) {
      await started.service.sendMessage({ agentId: "chief", text });
      await waitFor(() => started.service.listQueue("chief").deliveries[index]?.status === "completed");
    }

    const team = await createTeamApiFixture("transfer-budget", { configure: true });
    const { base } = await team.start({ agents: started.service });
    const token = await team.signIn();
    const responseBytes = async (path: string) => {
      const response = await fetch(`${base}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V4),
          [TEAM_CAPABILITIES_HEADER]: TEAM_CURRENT_CAPABILITIES.join(","),
        },
      });
      expect(response.status, path).toBe(200);
      return Buffer.byteLength(await response.text());
    };
    const measured: typeof BUDGETS = {
      teamConversationBytes: await responseBytes(TEAM_API_ROUTES.agent.conversation("chief")),
      teamConversationPageBytes: await responseBytes(TEAM_API_ROUTES.agent.conversationPage("chief")),
    };

    await mkdir(join(REPORT_PATH, ".."), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify({ measured, budgets: BUDGETS }, null, 2)}\n`);
    expect(measured.teamConversationBytes).toBeLessThanOrEqual(BUDGETS.teamConversationBytes);
    expect(measured.teamConversationPageBytes).toBeLessThanOrEqual(BUDGETS.teamConversationPageBytes);
  });
});
