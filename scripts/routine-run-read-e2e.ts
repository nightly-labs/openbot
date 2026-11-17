// Real node:sqlite: compiled run lookups retain live transaction and reopen behavior.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const projectRoot = process.env.OPENBOT_RUN_READ_TEST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build/routine-run-read-e2e");
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };

async function fixture() {
  const root = mkdtempSync(join(output, "run-"));
  const database = new OpenBotDatabase(root);
  const routines = new AgentRoutineStore(database);
  try {
    await runCauseEffect(database.initialize());
    database.connection.exec(`INSERT INTO projection_agent_routines
      (routine_id,agent_id,name,instruction,active,timezone,created_at,updated_at,last_event_sequence)
      VALUES ('routine','agent','Fixture','Check state.',1,'UTC','2026-01-01','2026-01-01',1);
      INSERT INTO projection_routine_runs
      (run_id,routine_id,agent_id,run_kind,scheduled_for,routine_name,instruction,delivery_id,status,error,created_at,updated_at,last_event_sequence)
      VALUES ('run','routine','agent','manual','2026-01-01','Fixture','Check state.','delivery','queued',NULL,'2026-01-01','2026-01-01',1);`);
    let handleCompiles = 0;
    const prepare = database.connection.prepare.bind(database.connection);
    database.connection.prepare = (sql) => {
      if (sql.includes("FROM projection_routine_runs WHERE delivery_id = ?")) handleCompiles++;
      return prepare(sql);
    };
    assert.equal(routines.runForDelivery("delivery")?.status, "queued");
    assert.equal(routines.runForDelivery("absent"), null);
    routines.updateRunStatus("run", "running");
    assert.equal(routines.runForDelivery("delivery")?.status, "running");
    database.connection.exec("BEGIN IMMEDIATE");
    routines.updateRunStatus("run", "needs-attention", "Pending input");
    assert.equal(routines.runForDelivery("delivery")?.status, "needs-attention");
    database.connection.exec("ROLLBACK");
    assert.equal(routines.runForDelivery("delivery")?.status, "running");
    assert.equal(handleCompiles, 1);
    report.checks.push(
      "Repeated lookups compile once but read current committed and uncommitted statuses; rollback restores the previous value.",
    );
    database.close();
    await runCauseEffect(database.initialize());
    assert.equal(routines.runForDelivery("delivery")?.status, "running");
    routines.updateRunStatus("run", "cancelled");
    assert.equal(routines.runForDelivery("delivery")?.status, "cancelled");
    database.connection.prepare("DELETE FROM projection_routine_runs WHERE run_id = ?").run("run");
    assert.equal(routines.runForDelivery("delivery"), null);
    report.checks.push(
      "The same routine store uses the reopened connection and sees cancellation and deletion without stale row data.",
    );
    report.passed = true;
  } finally {
    database.close();
  }
}

mkdirSync(output, { recursive: true });
if (process.argv.includes("--fixture")) {
  try {
    await fixture();
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
} else {
  const built = await Bun.build({
    entrypoints: [import.meta.filename],
    target: "node",
    format: "esm",
    outdir: output,
    naming: "fixture.mjs",
  });
  assert.ok(built.success, String(built.logs));
  const child = spawnSync("node", [join(output, "fixture.mjs"), "--fixture"], {
    cwd: projectRoot,
    env: { ...process.env, OPENBOT_RUN_READ_TEST_ROOT: projectRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout: 45_000,
  });
  // Machine-readable fixture output.
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.ifError(child.error);
  assert.equal(child.status, 0);
}
