import { randomUUID } from "node:crypto";
import {
  type CreateRoutineInput,
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  type RoutineMissedPolicy,
} from "@openbot/contracts/ipc";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, openRoutines, resumeHost, t } from "./support/ui";

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
        .then((runs) => runs.filter((run) => run.kind === "manual").map((run) => run.status)),
    )
    .toEqual(["succeeded"]);
  expect(
    (await conversation(app, agent.id)).messages.filter(
      (message) =>
        message.senderAgentId === child.id && message.text.includes("Status: done\nResult: Routine child result"),
    ),
  ).toHaveLength(1);
  // Open the saved routine again: a remote run can return the panel to its settings page.
  await app.page.getByRole("button", { name: t("routine.settings.closeDetails"), exact: true }).click();
  await openRoutines(app);
  await app.page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await app.page.getByPlaceholder(t("routine.settings.namePlaceholder")).fill(`${name} edited`);
  // The trigger's name is the label followed by the chosen frequency.
  await app.page.getByRole("button", { name: new RegExp(`^${t("routine.picker.frequency")} `) }).click();
  await app.page.getByRole("option", { name: t("routine.kind.custom"), exact: true }).click();
  const cron = app.page.getByRole("textbox", { name: t("routine.picker.cronExpression"), exact: true });
  await cron.fill("* * * * *");
  await cron.press("Enter");
  await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
  const tooOften = t("error.backend.routineCronTooOften", { minutes: ROUTINE_MINIMUM_INTERVAL_MINUTES });
  await expect(app.page.getByRole("alert").filter({ hasText: tooOften })).toHaveText(tooOften);
  expect((await routines()).find((entry) => entry.id === routine.id)?.trigger.schedule).toEqual(
    routine.trigger.schedule,
  );
  const schedule = { kind: "custom", expression: "15 4 * * 2" } as const;
  await cron.fill(schedule.expression);
  await cron.press("Enter");
  const active = app.page.getByRole("switch", { name: t("routine.settings.activeToggle") });
  await expect(active).toBeChecked();
  await active.focus();
  await expect(active).toBeFocused();
  await active.press("Space");
  await expect(active).not.toBeChecked();
  await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
  await expect
    .poll(async () => {
      const saved = (await routines()).find((entry) => entry.id === routine.id);
      return { active: saved?.active, schedule: saved?.trigger.schedule };
    })
    .toEqual({ active: false, schedule });
  await owner.restart();
  if (serverId) await resumeHost(app, owner, serverId);
  expect((await routines()).find((entry) => entry.id === routine.id)).toMatchObject({
    name: `${name} edited`,
    active: false,
    instruction: routine.instruction,
    trigger: { schedule },
  });
  await openAgent(app, agent.name);
  await openRoutines(app);
  await app.page.getByRole("button", { name: new RegExp(`^${name} edited`) }).click();
  await expect(app.page.getByRole("switch", { name: t("routine.settings.activeToggle") })).not.toBeChecked();
  await app.page.getByRole("switch", { name: t("routine.settings.activeToggle") }).press("Space");
  await expect(app.page.getByRole("switch", { name: t("routine.settings.activeToggle") })).toBeChecked();
  await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
  await expect.poll(async () => (await routines()).find((entry) => entry.id === routine.id)?.active).toBe(true);
  await app.page.getByRole("button", { name: t("common.delete"), exact: true }).click();
  await app.page.getByRole("button", { name: t("routine.settings.deleteNow"), exact: true }).click();
  await expect.poll(async () => (await routines()).some((entry) => entry.id === routine.id)).toBe(false);
  await owner.restart();
  if (serverId) await resumeHost(app, owner, serverId);
  expect((await routines()).some((entry) => entry.id === routine.id)).toBe(false);
});

test("schedule runs a due routine once after a restart and skips a missed one", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  // The owner's API sets a due time some seconds ahead: the schedule picker uses whole minutes. Only
  // the owner sets the missed-run policy: the UI and the Team API do not carry it to a remote host.
  const schedule = {
    kind: "interval",
    amount: 3,
    unit: "minutes",
    anchorAt: new Date(Date.now() + 3_000).toISOString(),
  } as const;
  const create = (name: string, active: boolean, missedPolicy: RoutineMissedPolicy) =>
    owner.page.evaluate((value) => window.openbot.agent.createRoutine(value), {
      agentId: agent.id,
      name,
      instruction: prompt({ reply: `${name} result` }),
      active,
      timezone: "UTC",
      schedule,
      missedPolicy,
    } satisfies CreateRoutineInput);
  const runOnce = await create("Run once", true, "run-once");
  const skip = await create("Skip", true, "skip");
  const paused = await create("Paused", false, "run-once");
  const dueAt = Date.parse(schedule.anchorAt);
  let stoppedAt = Number.POSITIVE_INFINITY;
  await owner.restart({
    whileStopped: async () => {
      stoppedAt = Date.now();
      // The scheduler compares due times with the wall clock. Wait for them while the app is closed.
      await expect.poll(() => Date.now(), { timeout: 10_000 }).toBeGreaterThan(dueAt);
    },
  });
  expect(stoppedAt, "The app must stop before the routines come due.").toBeLessThan(dueAt);
  if (serverId) await resumeHost(app, owner, serverId);
  await openAgent(app, agent.name);
  await completed(app, agent.id, "Run once result");
  // The owner's local history includes skipped-run records. The Team API leaves them out.
  const runs = (routineId: string) =>
    owner.page
      .evaluate((input) => window.openbot.agent.listRoutineRuns(input), { agentId: agent.id, routineId })
      .then((list) =>
        list.map((run) => ({ kind: run.kind, status: run.status, scheduledFor: run.scheduledFor, missed: run.missed })),
      );
  await expect
    .poll(() => runs(runOnce.id))
    .toEqual([{ kind: "scheduled", status: "succeeded", scheduledFor: schedule.anchorAt, missed: undefined }]);
  expect(await runs(skip.id)).toEqual([
    { kind: "scheduled", status: "cancelled", scheduledFor: schedule.anchorAt, missed: { count: 1, until: null } },
  ]);
  // The paused routine came due at the same time as the run-once routine, which ran.
  expect(await runs(paused.id)).toEqual([]);
  const saved = await app.page.evaluate((agentId) => window.openbot.agent.listRoutines(agentId), agent.id);
  const next = new Date(dueAt + 3 * 60_000).toISOString();
  expect(saved.find((entry) => entry.id === skip.id)?.trigger).toMatchObject({ schedule, nextRunAt: next });
  expect(saved.find((entry) => entry.id === runOnce.id)?.trigger).toMatchObject({ schedule, nextRunAt: next });
  const messages = (await conversation(app, agent.id)).messages;
  expect(messages.filter((message) => message.text === "Run once result")).toHaveLength(1);
  expect(messages.some((message) => message.text === "Skip result" || message.text === "Paused result")).toBe(false);
  await expect(
    app.page
      .getByRole("main", { name: t("conversation.view.label"), exact: true })
      .getByText("Run once result", { exact: true }),
  ).toBeVisible();
  for (const routine of [runOnce, skip, paused])
    await app.page.evaluate((value) => window.openbot.agent.deleteRoutine(value), {
      agentId: agent.id,
      routineId: routine.id,
    });
});
