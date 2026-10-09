import { randomUUID } from "node:crypto";
import type { CreateRoutineInput } from "@openbot/contracts/ipc";
import { assertHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, newAgent, openAgent, openRoutines, t } from "./support/ui";

test("routines creates, edits, runs, pauses, resumes, persists, and deletes", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  const child = await newAgent(app);
  const name = `Routine ${randomUUID().slice(0, 8)}`;
  await openAgent(app, agent.name);
  await openRoutines(app);
  await app.page.getByRole("button", { name: t("routine.settings.create") }).click();
  await app.page.getByPlaceholder(t("routine.settings.namePlaceholder")).fill(name);
  await app.page.getByRole("textbox", { name: t("routine.settings.instruction"), exact: true }).fill(
    prompt({
      steps: [
        {
          kind: "tool",
          name: "send_message",
          args: { recipientAgentIds: [child.id], text: prompt({ reply: "Routine child result" }) },
        },
      ],
      reply: "Routine dispatched",
    }),
  );
  await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
  const routines = () => app.page.evaluate((agentId) => window.openbot.agent.listRoutines(agentId), agent.id);
  await expect.poll(async () => (await routines()).find((routine) => routine.name === name)?.id).toBeTruthy();
  const routine = (await routines()).find((entry) => entry.name === name);
  if (!routine) throw new Error("The saved routine is missing.");
  await app.page.getByRole("button", { name: t("routine.settings.testRun"), exact: true }).click();
  await completed(app, agent.id, "Routine child result");
  await expect
    .poll(() =>
      app.page
        .evaluate((input) => window.openbot.agent.listRoutineRuns(input), { agentId: agent.id, routineId: routine.id })
        .then((runs) => runs.some((run) => run.kind === "manual" && run.status === "succeeded")),
    )
    .toBe(true);
  await app.page.getByPlaceholder(t("routine.settings.namePlaceholder")).fill(`${name} edited`);
  await app.page.getByRole("switch", { name: t("routine.settings.activeToggle") }).uncheck();
  await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
  await expect.poll(async () => (await routines()).find((entry) => entry.id === routine.id)?.active).toBe(false);
  await owner.restart();
  if (serverId) await assertHost(app, serverId);
  await openAgent(app, agent.name);
  await openRoutines(app);
  await app.page.getByRole("button", { name: new RegExp(`${name} edited`) }).click();
  await expect(app.page.getByRole("switch", { name: t("routine.settings.activeToggle") })).not.toBeChecked();
  await app.page.getByRole("switch", { name: t("routine.settings.activeToggle") }).check();
  await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
  await expect.poll(async () => (await routines()).find((entry) => entry.id === routine.id)?.active).toBe(true);
  await app.page.getByRole("button", { name: t("common.delete"), exact: true }).click();
  await app.page.getByRole("button", { name: t("routine.settings.deleteNow"), exact: true }).click();
  await expect.poll(async () => (await routines()).some((entry) => entry.id === routine.id)).toBe(false);
});

test("schedule executes a due persisted schedule once", async ({ app }) => {
  const agent = await newAgent(app);
  const input: CreateRoutineInput = {
    agentId: agent.id,
    name: "Scheduled release task",
    instruction: prompt({ reply: "Scheduled result" }),
    active: true,
    timezone: "UTC",
    // A short due time is test input. The real scheduler decides when to fire.
    schedule: { kind: "interval", amount: 3, unit: "minutes", anchorAt: new Date(Date.now() + 5_000).toISOString() },
  };
  const routine = await app.page.evaluate((value) => window.openbot.agent.createRoutine(value), input);
  await openAgent(app, agent.name);
  await completed(app, agent.id, "Scheduled result");
  const runs = await app.page.evaluate((input) => window.openbot.agent.listRoutineRuns(input), {
    agentId: agent.id,
    routineId: routine.id,
  });
  expect(runs.filter((run) => run.kind === "scheduled" && run.status === "succeeded")).toHaveLength(1);
  await expect(app.page.getByText("Scheduled result", { exact: true })).toBeVisible();
  await app.page.evaluate((value) => window.openbot.agent.deleteRoutine(value), {
    agentId: agent.id,
    routineId: routine.id,
  });
});
