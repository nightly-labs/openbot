// Shared steps of the channel E2E scripts. Each script drives this worktree's running dev app
// (`bun run dev`, never `--shared`) through the real preload bridge, so it changes the data of the
// profile. It makes its own channels and deletes them at the end; it does not touch other channels.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type {
  AgentSummary,
  Channel,
  ChannelCommand,
  ChannelDraft,
  ChannelPage,
  ChannelSummary,
  ClientAgentSummary,
  OpenBotDesktopApi,
  QueueSnapshot,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { TEAM_PROTOCOL_V8, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { decodeTeamProtocolSupportV8Base } from "../packages/contracts/src/team-protocol/v8-base";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

export const WAIT_MS = 180_000;
// Long enough that a turn still runs while a script checks the other lanes, also on a fast model.
export const LONG_PROMPT = "Write a numbered list of 300 short facts about rivers, one per line. Do not use tools.";
export const SHORT_PROMPT = "Reply with the single word ready. Do not use tools.";

export const argument = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

export interface ChannelE2e {
  page: Page;
  instance: DevInstanceRecord;
  close: () => Promise<void>;
}

/** Connects to the one dev app of this worktree, after the mutation gate. */
export async function connectChannelE2e(command: string): Promise<ChannelE2e> {
  const instances = readDevInstanceRecords().filter(
    (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
  );
  assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
  const instance = instances[0];
  assert.ok(instance);
  assertMutationAllowed({
    command,
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: true,
    target: instance.instanceId,
  });
  const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger(command), {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
  return { page: session.page, instance, close: session.close };
}

export function writeReport(name: string, report: unknown): string {
  const out = resolve(import.meta.dirname, `../.openbot-build/${name}`);
  mkdirSync(out, { recursive: true });
  const path = resolve(out, "report.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/** Reads `read` again until `ready` accepts it. The app pushes no event to a script. */
export async function waitFor<T>(
  page: Page,
  label: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    last = await read();
    if (ready(last)) return last;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}. Last value: ${JSON.stringify(last)}`);
    await page.waitForTimeout(250);
  }
}

export class ChannelClient {
  readonly created: string[] = [];
  readonly chatted = new Set<string>();
  constructor(readonly page: Page) {}

  /** The visible agents on a provider that this OpenBot knows. */
  async agents(): Promise<AgentSummary[]> {
    const agents = await this.page.evaluate(() => window.openbot.agent.listAgents());
    return agents.filter((agent): agent is AgentSummary => isAgentProvider(agent.provider));
  }

  list(): Promise<ChannelSummary[]> {
    return this.page.evaluate(() => window.openbot.agent.listChannels());
  }

  async summary(channelId: string): Promise<ChannelSummary> {
    const summary = (await this.list()).find((channel) => channel.id === channelId);
    assert.ok(summary, `Channel ${channelId} is not in the list.`);
    return summary;
  }

  read(channelId: string): Promise<ChannelPage> {
    return this.page.evaluate((id) => window.openbot.agent.readChannel({ channelId: id }), channelId);
  }

  command(command: ChannelCommand): Promise<Channel> {
    return this.page.evaluate((input) => window.openbot.agent.channelCommand(input), command);
  }

  async create(name: string, members: string[], leadAgentId: string | null): Promise<Channel> {
    const draft: ChannelDraft = {
      name,
      title: "",
      instructions: "An end-to-end test channel. Keep each answer short.",
      members: members.map((agentId) => ({ agentId })),
      leadAgentId,
    };
    const channel = await this.command({
      type: "save",
      operationId: crypto.randomUUID(),
      channelId: crypto.randomUUID(),
      draft,
    });
    this.created.push(channel.id);
    return channel;
  }

  send(channelId: string, text: string, recipientAgentId: string | null): Promise<Channel> {
    return this.command({
      type: "send",
      operationId: crypto.randomUUID(),
      channelId,
      text,
      recipientAgentId,
      replyToMessageId: null,
      attachmentDraftIds: [],
    });
  }

  taskCommand(
    type: "stop" | "resume" | "reassign" | "cancel",
    channelId: string,
    taskId: string,
    recipientAgentId = null,
  ) {
    return this.command({ type, operationId: crypto.randomUUID(), channelId, taskId, recipientAgentId });
  }

  queue(agentId: string): Promise<QueueSnapshot> {
    return this.page.evaluate((id) => window.openbot.agent.listQueue(id), agentId);
  }

  sendToAgent(agentId: string, text: string) {
    this.chatted.add(agentId);
    return this.page.evaluate(
      (input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }),
      { agentId, text },
    );
  }

  setHidden(agentId: string, hidden: boolean) {
    return this.page.evaluate((input) => window.openbot.agent.setAgentHidden(input), { agentId, hidden });
  }

  update(agentId: string, change: Omit<UpdateAgentInput, "agentId">): Promise<ClientAgentSummary> {
    return this.page.evaluate((input) => window.openbot.agent.updateAgent(input), { agentId, ...change });
  }

  /** Stops the running turn of the agent's own chat. */
  async stopOwnChat(agentId: string): Promise<void> {
    const snapshot = await this.queue(agentId).catch(() => null);
    for (const delivery of snapshot?.deliveries ?? [])
      if (delivery.turnId && (delivery.status === "starting" || delivery.status === "running"))
        await this.page
          .evaluate((input) => window.openbot.agent.interrupt(input), { agentId, turnId: delivery.turnId })
          .catch(() => undefined);
  }

  /**
   * Stops the own-chat turns this script started, and the open tasks of the channels it made. Then
   * archives and deletes those channels.
   */
  async cleanup(): Promise<void> {
    for (const agentId of this.chatted) await this.stopOwnChat(agentId);
    for (const channelId of this.created) {
      const page = await this.read(channelId).catch(() => null);
      for (const task of page?.tasks ?? [])
        if (task.state === "queued" || task.state === "running" || task.state === "waiting")
          await this.taskCommand("stop", channelId, task.id).catch(() => undefined);
      await this.command({ type: "archive", operationId: crypto.randomUUID(), channelId }).catch(() => undefined);
      await this.page.evaluate((id) => window.openbot.agent.deleteChannel(id), channelId).catch(() => undefined);
    }
  }
}

/** Is any delivery of this queue starting or running? */
export function queueBusy(snapshot: QueueSnapshot): boolean {
  return snapshot.deliveries.some((delivery) => delivery.status === "starting" || delivery.status === "running");
}

/**
 * The advertised capabilities of the dev app's Team API host. The host takes a free loopback port at
 * start and no record names it, so this asks each port that the app's processes listen on.
 */
export async function hostCapabilities(instance: DevInstanceRecord): Promise<string[]> {
  const children = execFileSync("pgrep", ["-P", String(instance.pid)], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const ports = new Set<number>();
  for (const pid of [String(instance.pid), ...children]) {
    let listing = "";
    try {
      listing = execFileSync("lsof", ["-nP", "-a", "-p", pid, "-iTCP", "-sTCP:LISTEN", "-Fn"], { encoding: "utf8" });
    } catch {
      continue;
    }
    for (const line of listing.split("\n")) {
      const match = /^n127\.0\.0\.1:(\d+)$/.exec(line);
      if (match?.[1] && Number(match[1]) !== instance.remoteDebuggingPort) ports.add(Number(match[1]));
    }
  }
  for (const port of ports) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/compatibility`, {
      headers: { [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V8) },
    }).catch(() => null);
    if (!response?.ok) continue;
    return decodeTeamProtocolSupportV8Base(await response.json()).capabilities;
  }
  throw new Error(`No Team API host answered on the ports of the dev app: ${[...ports].join(", ")}.`);
}
