// Real preference persistence and SQLite-backed MCP gateway. No provider or Google account starts.
// Writes .openbot-build/connector-access-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseConnectorAccessChange } from "@openbot/contracts/ipc";
import { CONNECTOR_ACCESS_CODECS, CONNECTOR_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/connector-access-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import { McpServerStore } from "../src/backend/mcp-server-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { ConnectorAccessStore } from "../src/main/connector-access-store";

const root = await mkdtemp(join(tmpdir(), "openbot-connector-access-"));
const out = resolve(import.meta.dirname, "../.openbot-build/connector-access-e2e");
const report: { passed: boolean; steps: string[]; unverified: string[] } = {
  passed: false,
  steps: [],
  unverified: ["Host UI rendering and live provider accounts; no credentials or live host were used."],
};
const db = new OpenBotDatabase(root);
let gateway: McpGateway | undefined;
try {
  await Effect.runPromise(db.initialize());
  const store = new McpServerStore(db);
  const config = (name: string) =>
    store.save({
      id: "",
      name,
      transport: "stdio",
      enabled: true,
      command: "fixture-never-launched",
      args: [],
      env: [{ key: "PRIVATE_FIXTURE", value: "do-not-handoff" }],
      envPassthrough: [],
      workingDirectory: "",
      url: "",
      headers: [],
    });
  const privateConfig = config("Private Google");
  const legacy = config("Legacy");
  const path = join(root, "connector-policy.json");
  const policy = new ConnectorAccessStore(path);
  assert.equal(await Effect.runPromise(policy.load()), true);
  gateway = new McpGateway({
    servers: store,
    credentials: NO_PROVIDER_CREDENTIALS,
    computerUseMcpServer: () => null,
    logger: createOpenBotLogger("connector-test", () => undefined),
    allowsConnector: (id, agent) => policy.allows(id, agent),
    hooks: { emitError: () => undefined, refreshAllAgentRuntimes: () => Effect.void },
  });
  const rule = {
    mcpServerId: privateConfig.id,
    agentIds: ["private-agent"],
    everyoneUse: false,
    roleIds: ["mail-role"],
  };
  assert.equal(gateway.enabled("public-agent").length, 2);
  await Effect.runPromise(policy.set({ revision: 0, rules: [rule] }, () => Effect.void));
  assert.deepEqual(
    gateway.enabled("public-agent").map((item) => item.id),
    [legacy.id],
  );
  assert.deepEqual(
    gateway.enabled(null).map((item) => item.id),
    [legacy.id],
  );
  assert.equal(gateway.enabled("private-agent").length, 2);
  const member = { id: "member-one", role: "member" as const };
  const roles = {
    revision: 1,
    everyone: {},
    roles: [{ id: "mail-role", name: "Mail", agents: {}, memberIds: [member.id] }],
  };
  assert.equal(policy.memberMaySeeAgent(member, "private-agent", roles), true);
  assert.equal(policy.memberMaySeeAgent({ ...member, id: "unknown-member" }, "private-agent", roles), false);
  assert.equal(policy.memberMaySeeAgent(member, "private-agent", { ...roles, roles: [] }), false);
  assert.equal(policy.sameAudience("private-agent", "public-agent"), false);
  report.steps.push(
    "Legacy handoff unchanged; protected configs excluded before secret/env handoff for public and unknown agents; current role membership gates whole history.",
  );

  // A failed teardown cannot reopen provider handoffs or expose the agent to members.
  await assert.rejects(
    Effect.runPromise(
      policy.set({ revision: 1, rules: [{ ...rule, agentIds: [] }] }, () =>
        Effect.fail(new Error("fixture stop failed")),
      ),
    ),
  );
  assert.equal(policy.snapshot([]).closed, true);
  assert.deepEqual(gateway.enabled("private-agent"), []);
  assert.equal(policy.memberMaySeeAgent(member, "private-agent", roles), false);
  await Effect.runPromise(policy.set({ revision: 2, rules: [] }, () => Effect.void));
  assert.equal(policy.snapshot([]).closed, false);
  assert.equal(policy.allows(privateConfig.id, "private-agent"), false);
  assert.equal(policy.memberMaySeeAgent(member, "private-agent", roles), true);
  assert.deepEqual(policy.audience("private-agent"), [privateConfig.id]);
  const duplicateWrite = await Promise.allSettled([
    Effect.runPromise(policy.set({ revision: 3, rules: [] }, () => Effect.void)),
    Effect.runPromise(policy.set({ revision: 3, rules: [] }, () => Effect.void)),
  ]);
  assert.equal(duplicateWrite.filter((item) => item.status === "fulfilled").length, 1);
  const reloaded = new ConnectorAccessStore(path);
  assert.equal(await Effect.runPromise(reloaded.load()), true);
  assert.deepEqual(reloaded.audience("private-agent"), [privateConfig.id]);
  report.steps.push(
    "Revocation failure closes new access; retry succeeds without dropping history bindings; concurrent stale save refused and bindings survive restart.",
  );

  assert.throws(() => parseConnectorAccessChange({ revision: 0, rules: [{ ...rule, audienceAgentIds: [] }] }));
  const codec = CONNECTOR_ACCESS_CODECS.get(CONNECTOR_ACCESS_ROUTES.set);
  assert.ok(codec);
  assert.throws(() =>
    codec.request({
      revision: 0,
      rules: [{ ...rule, audienceAgentIds: [] }],
    }),
  );
  report.steps.push("Application and negotiated wire decoders reject caller-injected history audience.");
  await writeFile(path, '{"version":1,"rules":');
  const damaged = new ConnectorAccessStore(
    path,
    () => {},
    () => ({ agentIds: ["private-agent", "public-agent"], connectorIds: [privateConfig.id, legacy.id] }),
  );
  assert.equal(await Effect.runPromise(damaged.load()), false);
  assert.equal(damaged.memberMaySeeAgent(member, "public-agent", roles), false);
  await Effect.runPromise(damaged.set({ revision: 0, rules: [] }, () => Effect.void));
  assert.equal(damaged.allows(privateConfig.id, "private-agent"), false);
  assert.equal(damaged.memberMaySeeAgent(member, "private-agent", roles), false);
  assert.equal(damaged.memberMaySeeAgent(member, "public-agent", roles), false);
  assert.ok(damaged.audience("public-agent").includes("connector-policy-recovery"));
  const persisted = JSON.parse(await readFile(path, "utf8"));
  assert.equal(persisted.version, 1);
  report.steps.push(
    "Corrupt policy denies access; explicit safe recovery protects every existing agent and current connector with no assignments or grants.",
  );
  report.passed = true;
} finally {
  if (gateway) await Effect.runPromise(gateway.close());
  db.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
