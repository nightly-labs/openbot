import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { chromium, type Page } from "playwright-core";

declare global {
  interface Window {
    scheduleCalendarRequests?: string[];
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/schedule-server-switch-e2e");
const t = translateFor("en");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface Report {
  from?: string;
  to?: string;
  requests?: string[];
  routinesBeforeSwitch?: string[];
  routinesAfterSwitch?: string[];
  passed: boolean;
}

const report: Report = { passed: false };

async function calendarReady(page: Page): Promise<void> {
  const schedule = page.getByRole("region", { name: t("routine.calendar.title") });
  await schedule.waitFor();
  await schedule
    .getByRole("status")
    .filter({ hasText: t("routine.calendar.loading") })
    .waitFor({ state: "detached" });
  assert.equal(await schedule.getByText(t("routine.calendar.loadFailed")).count(), 0, "The calendar shows its error.");
}

async function visibleRoutines(page: Page): Promise<string[]> {
  const runs = page
    .getByRole("region", { name: t("routine.calendar.title") })
    .getByRole("button", { name: /^Routine@/ });
  const labels = await runs.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
  return [...new Set(labels.map((label) => label.split(",")[0] ?? ""))];
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${storybook}/iframe.html?id=app--playground&viewMode=story`);
  await page.getByRole("button", { name: t("app.rail.schedule"), exact: true }).waitFor();
  await page.evaluate(() => {
    const agent = window.openbot.agent;
    window.scheduleCalendarRequests = [];
    agent.routineCalendar = async (_input, server) => {
      const serverId = typeof server === "string" ? server : "local";
      window.scheduleCalendarRequests?.push(serverId);
      const at = new Date(Date.now() + 3_600_000).toISOString();
      return {
        routines: [
          {
            id: `routine-${serverId}`,
            name: `Routine@${serverId}`,
            owner: { kind: "agent", agentId: `agent-${serverId}` },
            active: true,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            schedule: { kind: "daily", time: "09:00" },
          },
        ],
        runs: [{ id: `run-${serverId}`, routineId: `routine-${serverId}`, at, status: "scheduled" }],
      };
    };
  });

  const servers = await page.evaluate(() => window.openbot.servers.list());
  const from = servers.find((server) => server.active);
  const to = servers.find((server) => !server.active && server.state === "online");
  assert.ok(from && to, "The preview needs an active server and another online server.");
  report.from = from.id;
  report.to = to.id;

  await page.getByRole("button", { name: t("app.rail.schedule"), exact: true }).click();
  await calendarReady(page);
  report.routinesBeforeSwitch = await visibleRoutines(page);
  assert.deepEqual(report.routinesBeforeSwitch, [`Routine@${from.id}`], "The first server's calendar is wrong.");

  await page.getByRole("button", { name: t("server.menu.open", { name: from.name }), exact: true }).click();
  await page.getByRole("menuitem", { name: to.name, exact: true }).click();
  await page.getByRole("button", { name: t("server.menu.open", { name: to.name }), exact: true }).waitFor();
  await page.waitForFunction((serverId) => window.scheduleCalendarRequests?.includes(serverId), to.id);
  await calendarReady(page);

  report.requests = await page.evaluate(() => window.scheduleCalendarRequests ?? []);
  report.routinesAfterSwitch = await visibleRoutines(page);
  assert.equal(report.requests.at(-1), to.id, "The calendar did not ask the new server.");
  assert.deepEqual(report.routinesAfterSwitch, [`Routine@${to.id}`], "The new server's calendar is wrong.");
  await page.screenshot({ path: resolve(OUT, "after-switch.png") });
  report.passed = true;
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
