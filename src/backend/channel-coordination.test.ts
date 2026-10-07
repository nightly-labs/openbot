import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelMessage, ChannelTask } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { channelFailure } from "./channel-effects";
import type { ChannelTextModel } from "./channel-history";
import { ChannelService } from "./channel-service";
import { runChannel } from "./channel-test-runtime";

let root: string;
let data: ReturnType<typeof stores>;
let service: ChannelService;
const actor = { id: "human-1", name: "Alex" };
const generate = vi.fn<ChannelTextModel>();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-coordination-"));
  data = stores(root);
  await runChannel(data.store.initialize());
  await runChannel(data.mailbox.initialize());
  await runChannel(data.store.getOrCreate("agent-a"));
  await runChannel(data.store.getOrCreate("agent-b"));
  generate.mockReset();
  service = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate,
    busy: () => false,
    schedule: () => {},
    interrupt: () => Effect.void,
    changed: () => {},
    error: (error) => {
      throw error;
    },
  });
  await runChannel(
    service.command(
      {
        type: "save",
        operationId: "create-channel",
        channelId: "channel-1",
        draft: {
          name: "Release",
          title: "Release coordination",
          instructions: "Prepare the release",
          members: data.store.list().map((agent) => ({ agentId: agent.id })),
          leadAgentId: "agent-a",
        },
      },
      actor,
    ),
  );
});

afterEach(async () => {
  await runChannel(service.stop());
  data.store.database.close();
  await rm(root, { recursive: true, force: true });
});

describe("restricted channel context", () => {
  it.each(["lead", "all"] as const)(
    "retains referenced replies, saved facts and older live work for %s requests",
    async (audience) => {
      await runChannel(
        service.command(
          {
            type: "send",
            operationId: "start-work",
            channelId: "channel-1",
            text: "LONG_RUNNING_RELEASE_WORK",
            recipientAgentId: "agent-b",
            replyToMessageId: null,
            attachmentDraftIds: [],
          },
          actor,
        ),
      );
      await vi.waitFor(() => expect(service.store.assignments("channel-1")[0]?.deliveryId).toBeTruthy());
      const work = required(service.store.tasks("channel-1")[0]);
      const assignment = required(service.store.assignments("channel-1")[0]);
      const deliveryId = required(assignment.deliveryId);
      await runChannel(service.prepare(required(data.mailbox.getDelivery(deliveryId))));
      await runChannel(data.mailbox.markStarting(deliveryId));
      await runChannel(data.mailbox.markRunning(deliveryId, "release-work-turn"));
      await runChannel(service.accepted(deliveryId, "release-session", "release-work-turn"));

      const completed: ChannelTask[] = Array.from({ length: 80 }, (_, index) => ({
        ...work,
        id: `completed-${index}`,
        state: "completed",
        instruction: `Finished request ${index}`,
      }));
      const messages: ChannelMessage[] = Array.from({ length: 25 }, (_, index) => ({
        id: `history-${index}`,
        channelId: "channel-1",
        sequence: 0,
        author: { kind: "member", ...actor },
        taskId: null,
        superseded: false,
        message: {
          id: `history-${index}`,
          author: "user",
          text: index === 0 ? "ORIGINAL_RELEASE_PLAN" : index === 1 ? "SELECTED_PLAN_REPLY" : `Discussion ${index}`,
          replyToMessageId: index === 1 ? "history-0" : null,
          status: "completed",
          createdAt: "2026-09-07T12:00:00Z",
        },
      }));
      service.store.update(service.store.get("channel-1"), { tasks: completed, messages });
      service.createMemory({ channelId: "channel-1", text: "SAVED_CHANNEL_RELEASE_FACT" });
      generate.mockImplementation((_agent, prompt) =>
        Effect.tryPromise({
          try: async () => {
            const hasContext = [
              "ORIGINAL_RELEASE_PLAN",
              "SELECTED_PLAN_REPLY",
              '"replyToMessageId":"history-0"',
              "SAVED_CHANNEL_RELEASE_FACT",
              work.id,
              "LONG_RUNNING_RELEASE_WORK",
            ].every((value) => prompt.includes(value));
            return JSON.stringify({
              reply: hasContext ? "The plan and release facts are recorded; work is running." : "Context is missing.",
              ...(audience === "lead" ? { actions: [] } : {}),
            });
          },
          catch: channelFailure,
        }),
      );
      await runChannel(
        service.command(
          {
            type: "coordinate",
            operationId: "reply-to-plan",
            channelId: "channel-1",
            audience,
            text: "Use this plan and report the recorded release status",
            replyToMessageId: "history-1",
            attachmentDraftIds: [],
          },
          actor,
        ),
      );
      await vi.waitFor(() =>
        expect(
          service.store
            .messages("channel-1")
            .some(
              (entry) =>
                entry.author.id === "agent-a" &&
                entry.message.text === "The plan and release facts are recorded; work is running.",
            ),
        ).toBe(true),
      );
      expect(service.store.tasks("channel-1").find((task) => task.id === work.id)?.state).toBe("running");
      expect(service.store.assignments("channel-1")).toHaveLength(1);
    },
  );
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("The expected test record is missing.");
  return value;
}
