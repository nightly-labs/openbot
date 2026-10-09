import { randomUUID } from "node:crypto";
import type { CreateRoutineInput } from "@openbot/contracts/ipc";
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
  const active = app.page.getByRole("switch", { name: t("routine.settings.activeToggle") });
  await expect(active).toBeChecked();
  await active.focus();
  await expect(active).toBeFocused();
  await active.press("Space");
  await expect(active).not.toBeChecked();
  await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
  await expect.poll(async () => (await routines()).find((entry) => entry.id === routine.id)?.active).toBe(false);
  await owner.restart();
  if (serverId) await resumeHost(app, owner, serverId);
  expect((await routines()).find((entry) => entry.id === routine.id)).toMatchObject({
    name: `${name} edited`,
    active: false,
    instruction: routine.instruction,
    trigger: { schedule: routine.trigger.schedule },
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
});

test("schedule executes a due persisted schedule once", async ({ app, owner, serverId }) => {
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
  await owner.restart();
  if (serverId) await resumeHost(app, owner, serverId);
  await openAgent(app, agent.name);
  await completed(app, agent.id, "Scheduled result");
  const runs = await app.page.evaluate((input) => window.openbot.agent.listRoutineRuns(input), {
    agentId: agent.id,
    routineId: routine.id,
  });
  expect(runs.filter((run) => run.kind === "scheduled" && run.status === "succeeded")).toHaveLength(1);
  expect(runs[0]?.scheduledFor).toBe(routine.trigger.nextRunAt);
  const saved = (await app.page.evaluate((agentId) => window.openbot.agent.listRoutines(agentId), agent.id)).find(
    (entry) => entry.id === routine.id,
  );
  expect(saved?.trigger.schedule).toEqual(input.schedule);
  expect(Date.parse(saved?.trigger.nextRunAt ?? "")).toBeGreaterThan(Date.parse(routine.trigger.nextRunAt));
  const messages = (await conversation(app, agent.id)).messages;
  expect(messages.filter((message) => message.text === "Scheduled result")).toHaveLength(1);
  await expect(
    app.page
      .getByRole("main", { name: t("conversation.view.label"), exact: true })
      .getByText("Scheduled result", { exact: true }),
  ).toBeVisible();
  await app.page.evaluate((value) => window.openbot.agent.deleteRoutine(value), {
    agentId: agent.id,
    routineId: routine.id,
  });
});
