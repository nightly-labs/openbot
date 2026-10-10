import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { type ChannelAudienceInput, parseChannelAudienceInput } from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES, channelResponse } from "@openbot/contracts/team-protocol/channels-v1";
import { Effect } from "effect";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { ChannelService } from "./channel-service";
import { runChannel } from "./channel-test-runtime";

let root: string;
let data: ReturnType<typeof stores>;
let service: ChannelService;
const actor = { id: "member", name: "Alex" };
const busy = vi.fn(() => true);
const schedule = vi.fn();
const changed = vi.fn();
const input = (patch: Partial<ChannelAudienceInput> = {}): ChannelAudienceInput => ({
  channelId: "room",
  operationId: "input",
  text: "Review the report",
  audience: { kind: "members", agentIds: ["a", "b"] },
  replyToMessageId: null,
  attachmentDraftIds: [],
  ...patch,
});
function makeService() {
  return new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    busy,
    schedule,
    changed,
    interrupt: () => Effect.void,
    generate: () => Effect.succeed('{"agentId":"a"}'),
    error: (error) => {
      throw error;
    },
  });
}
async function reopen() {
  await runChannel(service.stop());
  data.store.database.close();
  data = stores(root);
  await runChannel(data.store.initialize());
  await runChannel(data.mailbox.initialize());
  service = makeService();
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-channel-audience-"));
  data = stores(root);
  await runChannel(data.store.initialize());
  await runChannel(data.mailbox.initialize());
  for (const id of ["a", "b", "c"]) await runChannel(data.store.getOrCreate(id));
  busy.mockReset();
  busy.mockReturnValue(true);
  schedule.mockClear();
  changed.mockClear();
  service = makeService();
  await runChannel(
    service.command(
      {
        type: "save",
        operationId: "create",
        channelId: "room",
        draft: {
          name: "Room",
          title: "",
          instructions: "Review",
          members: [{ agentId: "a" }, { agentId: "b" }, { agentId: "c" }],
          leadAgentId: "a",
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

it("accepts one message and each ordered target once; receipt survives retry, cold reopen and replay", async () => {
  const receipt = await runChannel(
    service.audiences.send(input({ audience: { kind: "members", agentIds: ["b", "a"] } }), actor),
  );
  assert(!("status" in receipt));
  expect(receipt.targets.map((target) => target.agentId)).toEqual(["b", "a"]);
  const page = service.store.page("room");
  expect(page.messages).toHaveLength(1);
  expect(page.messages[0]?.audience).toEqual(receipt.targets);
  expect(page.tasks.map((task) => task.requestMessageId)).toEqual([receipt.requestMessageId, receipt.requestMessageId]);
  expect(new Set(page.tasks.map((task) => task.rootTaskId)).size).toBe(2);
  expect(service.store.assignments("room")).toHaveLength(0);
  expect(await runChannel(service.audiences.send(input(), actor))).toEqual(receipt);
  await reopen();
  expect(await runChannel(service.audiences.send(input(), actor))).toEqual(receipt);
  service.store.rebuild("room");
  expect(service.store.page("room").messages[0]?.audience).toEqual(receipt.targets);
  expect(service.audiences.receipt(input(), actor.id)).toEqual(receipt);
  expect(service.audiences.receipt({ ...input(), channelId: "foreign" }, actor.id)).toBeNull();
  expect(service.audiences.receipt(input(), "other-member")).toBeNull();
});

it("rejects a non-member whole set before consuming files or committing any root", async () => {
  const file = join(root, "brief.txt");
  await writeFile(file, "the brief");
  const draft = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
  expect(draft).toBeDefined();
  if (!draft) throw new Error("Missing draft.");
  const refused = await runChannel(
    service.audiences.send(
      input({ audience: { kind: "members", agentIds: ["a", "outsider"] }, attachmentDraftIds: [draft.id] }),
      actor,
    ),
  );
  expect(refused).toEqual({ status: "not-accepted", reason: "validation", channelId: "room", operationId: "input" });
  expect(service.store.page("room").messages).toEqual([]);
  expect(service.store.tasks("room")).toEqual([]);
  expect(service.audiences.receipt(input(), actor.id)).toEqual(refused);
  expect(await runChannel(service.audiences.send(input({ attachmentDraftIds: [draft.id] }), actor))).toEqual(refused);
  const corrected = await runChannel(
    service.audiences.send(input({ operationId: "corrected", attachmentDraftIds: [draft.id] }), actor),
  );
  assert(!("status" in corrected));
  expect(corrected.targets).toHaveLength(2);
});

it("all accepts the current member snapshot including lead; retry ignores later membership changes", async () => {
  const receipt = await runChannel(service.audiences.send(input({ audience: { kind: "all" } }), actor));
  assert(!("status" in receipt));
  expect(receipt.targets.map((target) => target.agentId)).toEqual(["a", "b", "c"]);
  const channel = service.store.get("room");
  await runChannel(
    service.command(
      {
        type: "save",
        operationId: "remove",
        channelId: "room",
        draft: { ...channel, members: [{ agentId: "a" }], leadAgentId: "a" },
      },
      actor,
    ),
  );
  expect(await runChannel(service.audiences.send(input({ audience: { kind: "all" } }), actor))).toEqual(receipt);
  expect(service.store.page("room").messages[0]?.audience).toEqual(receipt.targets);
});

it("retains prepared files after channel rollback and cold restart, copying and consuming them only once", async () => {
  const file = join(root, "brief.txt");
  await writeFile(file, "the brief");
  const draft = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
  if (!draft) throw new Error("Missing draft.");
  const request = input({
    text: `Review ${serializeAttachmentReference(draft.name, draft.id)}`,
    attachmentDraftIds: [draft.id],
  });
  data.store.database.connection.exec(
    "CREATE TEMP TRIGGER reject_audience BEFORE INSERT ON projection_channel_tasks BEGIN SELECT RAISE(ABORT, 'injected rollback'); END",
  );
  await expect(runChannel(service.audiences.send(request, actor))).rejects.toThrow("injected rollback");
  expect(service.store.tasks("room")).toHaveLength(0);
  expect(service.store.page("room").messages).toHaveLength(0);
  expect(service.audiences.receipt(request, actor.id)).toBeNull();
  await reopen();
  const receipt = await runChannel(service.audiences.send(request, actor));
  assert(!("status" in receipt));
  const message = service.store.page("room").messages[0];
  const attachment = message?.message.attachments?.[0];
  if (!attachment) throw new Error("Missing committed file.");
  const saved = await runChannel(data.mailbox.resolveAttachment(attachment.id));
  if (!saved) throw new Error("Missing file.");
  expect(await readFile(saved.path, "utf8")).toBe("the brief");
  expect(message?.message.text).toContain(attachment.id);
  expect(await runChannel(service.audiences.send(request, actor))).toEqual(receipt);
  expect(service.store.page("room").messages).toHaveLength(1);
  busy.mockReturnValue(false);
  await runChannel(service.wake("room"));
  await vi.waitFor(() =>
    expect(service.store.assignments("room").some((assignment) => assignment.deliveryId)).toBe(true),
  );
  const deliveryId = service.store.assignments("room")[0]?.deliveryId;
  if (!deliveryId) throw new Error("Missing delivery.");
  expect(data.mailbox.getDelivery(deliveryId)?.delivery.attachments).toHaveLength(1);
});

it("terminates archived preparation without roots and retains drafts for a corrected operation after restart", async () => {
  const file = join(root, "brief.txt");
  await writeFile(file, "the brief");
  const draft = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
  if (!draft) throw new Error("Missing draft.");
  const commit = data.mailbox.commitChannelAttachments.bind(data.mailbox);
  vi.spyOn(data.mailbox, "commitChannelAttachments").mockImplementationOnce((value) =>
    Effect.gen(function* () {
      const result = yield* commit(value);
      yield* service.command({ type: "archive", operationId: "archive", channelId: "room" }, actor).pipe(Effect.orDie);
      return result;
    }),
  );
  const request = input({ attachmentDraftIds: [draft.id] });
  const refused = await runChannel(service.audiences.send(request, actor));
  expect(refused).toHaveProperty("status", "not-accepted");
  expect(service.audiences.receipt(request, actor.id)).toEqual(refused);
  expect(service.store.tasks("room")).toEqual([]);
  await runChannel(service.command({ type: "restore", operationId: "restore", channelId: "room" }, actor));
  await reopen();
  expect(await runChannel(service.audiences.send(request, actor))).toEqual(refused);
  const corrected = await runChannel(service.audiences.send({ ...request, operationId: "corrected" }, actor));
  assert(!("status" in corrected));
  expect(corrected.targets).toHaveLength(2);
});

it("preserves peer roots when one member completes or stops, and group stops use distinct operations", async () => {
  const receipt = await runChannel(service.audiences.send(input(), actor));
  assert(!("status" in receipt));
  const [a, b] = service.store.tasks("room");
  if (!a || !b) throw new Error("Missing roots.");
  service.store.update(service.store.get("room"), { tasks: [{ ...a, state: "completed" }] });
  expect(service.store.tasks("room").find((task) => task.id === b.id)?.state).toBe("queued");
  await runChannel(
    service.command(
      { type: "stop", operationId: `stop-${b.id}`, channelId: "room", taskId: b.id, recipientAgentId: null },
      actor,
    ),
  );
  expect(service.store.tasks("room").find((task) => task.id === a.id)?.state).toBe("completed");
  expect(service.store.tasks("room").find((task) => task.id === b.id)?.state).toBe("paused");
  const group = await runChannel(service.audiences.send(input({ operationId: "group" }), actor));
  assert(!("status" in group));
  for (const target of group.targets)
    await runChannel(
      service.command(
        {
          type: "stop",
          operationId: `group-stop-${target.taskId}`,
          channelId: "room",
          taskId: target.taskId,
          recipientAgentId: null,
        },
        actor,
      ),
    );
  expect(
    service.store
      .tasks("room")
      .filter((task) => group.targets.some((target) => target.taskId === task.id))
      .map((task) => task.state),
  ).toEqual(["paused", "paused"]);
  expect(service.audiences.receipt(input(), actor.id)).toEqual(receipt);
});

it("keeps accepted audience metadata out of the frozen channel page", async () => {
  await runChannel(service.audiences.send(input(), actor));
  const encoded = channelResponse(CHANNEL_ROUTES.read, 200, service.store.page("room"));
  expect(JSON.stringify(encoded)).not.toContain('"audience"');
});

it("rejects duplicate, malformed and empty audience inputs", () => {
  expect(() => parseChannelAudienceInput(input({ audience: { kind: "members", agentIds: ["a", "a"] } }))).toThrow();
  expect(() => parseChannelAudienceInput(input({ audience: { kind: "members", agentIds: [] } }))).toThrow();
  expect(() => parseChannelAudienceInput({ ...input(), audience: { kind: "other" } })).toThrow();
});

it("terminates membership refusal after preparation and retains files for a corrected operation after restart", async () => {
  const file = join(root, "race.txt");
  await writeFile(file, "retained file");
  const draft = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
  if (!draft) throw new Error("Missing draft");
  const commit = data.mailbox.commitChannelAttachments.bind(data.mailbox);
  const channel = service.store.get("room");
  vi.spyOn(data.mailbox, "commitChannelAttachments").mockImplementationOnce((value) =>
    Effect.gen(function* () {
      const result = yield* commit(value);
      yield* Effect.sync(() => service.store.update({ ...channel, members: [{ agentId: "a" }], leadAgentId: "a" }));
      return result;
    }),
  );
  const request = input({ attachmentDraftIds: [draft.id] });
  const refused = await runChannel(service.audiences.send(request, actor));
  expect(refused).toHaveProperty("status", "not-accepted");
  expect(service.store.tasks("room")).toEqual([]);
  expect(service.store.page("room").messages).toEqual([]);
  expect(service.audiences.receipt(request, actor.id)).toEqual(refused);
  await runChannel(
    service.command({ type: "save", operationId: "restore-members", channelId: "room", draft: { ...channel } }, actor),
  );
  await reopen();
  service.store.rebuild("room");
  expect(await runChannel(service.audiences.send(request, actor))).toEqual(refused);
  const receipt = await runChannel(service.audiences.send({ ...request, operationId: "corrected" }, actor));
  assert(!("status" in receipt));
  expect(receipt.targets).toHaveLength(2);
  const attachment = service.store.page("room").messages[0]?.message.attachments?.[0];
  if (!attachment) throw new Error("Missing attachment");
  const resolved = await runChannel(data.mailbox.resolveAttachment(attachment.id));
  if (!resolved) throw new Error("Missing file");
  expect(await readFile(resolved.path, "utf8")).toBe("retained file");
});

it("keeps busy and host-resource FIFO, and real result/terminal handling releases only the completed root once", async () => {
  const first = await runChannel(
    service.audiences.send(input({ audience: { kind: "members", agentIds: ["b", "a"] } }), actor),
  );
  assert(!("status" in first));
  const later = await runChannel(
    service.audiences.send(input({ operationId: "later", audience: { kind: "members", agentIds: ["c"] } }), actor),
  );
  assert(!("status" in later));
  expect(schedule).not.toHaveBeenCalled();
  expect(service.store.assignments("room")).toEqual([]);
  busy.mockReturnValue(false);
  await runChannel(service.wake("room"));
  for (const [index, target] of [...first.targets, ...later.targets].entries()) {
    await vi.waitFor(() =>
      expect(service.store.assignments("room").some((item) => item.taskId === target.taskId && item.deliveryId)).toBe(
        true,
      ),
    );
    const assignment = service.store.assignments("room").find((item) => item.taskId === target.taskId);
    const deliveryId = assignment?.deliveryId;
    if (!deliveryId) throw new Error("Missing delivery");
    expect(service.store.assignments("room").map((item) => item.agentId)).toEqual(["b", "a", "c"].slice(0, index + 1));
    expect(
      service.store.assignments("room").filter((item) => item.state === "starting" || item.state === "running"),
    ).toHaveLength(1);
    const delivery = data.mailbox.getDelivery(deliveryId);
    if (!delivery) throw new Error("Missing context");
    const execution = await runChannel(service.prepare(delivery));
    if (!execution) throw new Error("Missing execution");
    const turnId = `turn-${index}`;
    await runChannel(data.mailbox.markStarting(deliveryId));
    await runChannel(data.mailbox.markRunning(deliveryId, turnId));
    await runChannel(service.accepted(deliveryId, `session-${index}`, turnId));
    await runChannel(
      service.tool("room", target.agentId, turnId, "result", "channel_result", { text: `Done ${index}` }),
    );
    await runChannel(data.mailbox.markTerminal(deliveryId, "completed"));
    service.event({
      type: "turn-completed",
      agentId: target.agentId,
      threadId: execution.threadId,
      turnId,
      status: "completed",
    });
    await vi.waitFor(() =>
      expect(service.store.tasks("room").find((task) => task.id === target.taskId)?.state).toBe("completed"),
    );
  }
  expect(service.store.tasks("room").map((task) => task.state)).toEqual(["completed", "completed", "completed"]);
  expect(service.store.page("room").messages.filter((message) => message.author.kind === "member")).toHaveLength(2);
  expect(service.store.page("room").messages.filter((message) => message.message.author === "assistant")).toHaveLength(
    3,
  );
  await runChannel(service.audiences.send(input(), actor));
  expect(service.store.assignments("room")).toHaveLength(3);
  expect(new Set(service.store.assignments("room").map((item) => item.deliveryId)).size).toBe(3);
});

it("keeps immutable accepted targets after reassign and cold read while showing the current task owner", async () => {
  const receipt = await runChannel(service.audiences.send(input(), actor));
  assert(!("status" in receipt));
  const target = receipt.targets[0];
  if (!target) throw new Error("Missing target");
  await runChannel(
    service.command(
      {
        type: "stop",
        channelId: "room",
        taskId: target.taskId,
        recipientAgentId: null,
        operationId: "stop-before-reassign",
      },
      actor,
    ),
  );
  await runChannel(
    service.command(
      { type: "reassign", channelId: "room", taskId: target.taskId, recipientAgentId: "c", operationId: "reassign" },
      actor,
    ),
  );
  await reopen();
  const page = service.store.page("room");
  expect(page.messages.find((message) => message.id === receipt.requestMessageId)?.audience).toEqual(receipt.targets);
  expect(page.tasks.find((task) => task.id === target.taskId)?.ownerAgentId).toBe("c");
  expect(service.audiences.receipt(input(), actor.id)).toEqual(receipt);
  expect(page.tasks).toHaveLength(2);
  expect(page.messages.filter((message) => message.author.kind === "member")).toHaveLength(1);
});

it("refusal receipt rollback exposes no terminal result; scoped retry and replay cannot revive a committed refusal", async () => {
  const request = input({ audience: { kind: "members", agentIds: ["a", "outsider"] } });
  data.store.database.connection.exec(
    "CREATE TEMP TRIGGER reject_refusal BEFORE INSERT ON orchestration_command_receipts WHEN json_extract(NEW.result_json, '$.status') = 'not-accepted' BEGIN SELECT RAISE(ABORT, 'receipt rollback'); END",
  );
  await expect(runChannel(service.audiences.send(request, actor))).rejects.toThrow("receipt rollback");
  expect(service.audiences.receipt(request, actor.id)).toBeNull();
  expect(service.store.tasks("room")).toEqual([]);
  data.store.database.connection.exec("DROP TRIGGER reject_refusal");
  const refused = await runChannel(service.audiences.send(request, actor));
  expect(refused).toHaveProperty("status", "not-accepted");
  await reopen();
  service.store.rebuild("room");
  expect(await runChannel(service.audiences.send(input(), actor))).toEqual(refused);
  expect(service.audiences.receipt(input(), "foreign-actor")).toBeNull();
  expect(service.audiences.receipt({ ...input(), channelId: "foreign-channel" }, actor.id)).toBeNull();
  const corrected = await runChannel(service.audiences.send(input({ operationId: "corrected" }), actor));
  assert(!("status" in corrected));
  expect(service.store.tasks("room")).toHaveLength(2);
});

it("accepted tasks keep draft file references usable by a changed draft until its view explicitly discards them", async () => {
  const file = join(root, "keep.txt");
  await writeFile(file, "kept content");
  const draft = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
  if (!draft) throw new Error("Missing draft");
  const request = input({ attachmentDraftIds: [draft.id] });
  await runChannel(service.audiences.send(request, actor));
  await reopen();
  const next = await runChannel(
    service.audiences.send({ ...request, operationId: "changed-draft", text: "Changed request" }, actor),
  );
  assert(!("status" in next));
  expect(service.store.tasks("room")).toHaveLength(4);
  await runChannel(data.mailbox.discardDraft(draft.id));
  const attachment = service.store.message("room", next.requestMessageId)?.message.attachments?.[0];
  if (!attachment) throw new Error("Missing accepted attachment");
  const resolved = await runChannel(data.mailbox.resolveAttachment(attachment.id));
  if (!resolved) throw new Error("Missing retained file");
  expect(await readFile(resolved.path, "utf8")).toBe("kept content");
});
