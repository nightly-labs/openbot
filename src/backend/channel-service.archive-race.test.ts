import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stores } from "./agent-service-test-harness";
import { ChannelService } from "./channel-service";
import { runChannel } from "./channel-test-runtime";

let root: string;
let service: ChannelService;
let data: ReturnType<typeof stores>;
const actor = { id: "human-1", name: "Alex" };
let count = 0;
let reported: unknown[] = [];
let allowReported = false;
const operationId = () => `command-${++count}`;

beforeEach(async () => {
  reported = [];
  allowReported = false;
  root = await mkdtemp(join(tmpdir(), "openbot-channels-archive-"));
  data = stores(root);
  await runChannel(data.store.initialize());
  await runChannel(data.mailbox.initialize());
  await runChannel(data.store.getOrCreate("agent-a"));
  service = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    generate: () => Effect.succeed(JSON.stringify({ agentId: "agent-a" })),
    schedule: () => undefined,
    interrupt: () => Effect.void,
    busy: () => false,
    usageLimited: () => false,
    changed: () => undefined,
    queueHoldChanged: () => undefined,
    error: (error) => {
      if (!allowReported) throw error;
      reported.push(error);
    },
  });
  await runChannel(
    service.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: operationId(),
        draft: {
          name: "Project",
          title: "Release coordination",
          instructions: "Ship the project",
          members: [{ agentId: "agent-a" }],
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

describe("send refused by an archive during the attachment copy", () => {
  it("keeps the attachment draft so the user can send again after restoring", async () => {
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
    if (!attachment) throw new Error("draft missing");
    let release!: () => void;
    const copying = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = data.mailbox.commitChannelAttachments.bind(data.mailbox);
    const copy = vi.spyOn(data.mailbox, "commitChannelAttachments").mockImplementation((input) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => copying);
        return yield* commit(input);
      }),
    );
    const sendCommand = () => ({
      type: "send" as const,
      channelId: "channel-1",
      operationId: operationId(),
      text: "Prepare the report",
      recipientAgentId: "agent-a",
      replyToMessageId: null,
      attachmentDraftIds: [attachment.id],
    });
    const sent = runChannel(service.command(sendCommand(), actor));
    await vi.waitFor(() => expect(copy).toHaveBeenCalled());
    await runChannel(service.command({ type: "archive", channelId: "channel-1", operationId: operationId() }, actor));
    release();
    await expect(sent).rejects.toThrow("Restore this channel before sending messages or changing tasks.");
    copy.mockRestore();

    // The composer still holds the same draft id; the user restores the channel and sends again.
    await runChannel(service.command({ type: "restore", channelId: "channel-1", operationId: operationId() }, actor));
    const retry = await runChannel(service.command(sendCommand(), actor)).then(
      () => "sent",
      (error: unknown) => `refused: ${error instanceof Error ? error.message : String(error)}`,
    );
    expect(retry).toBe("sent");
  });

  it("gives the drafts back when the archive lands after they were consumed", async () => {
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
    if (!attachment) throw new Error("draft missing");
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = data.mailbox.commitChannelAttachments.bind(data.mailbox);
    let consumed = false;
    const copy = vi.spyOn(data.mailbox, "commitChannelAttachments").mockImplementation((input) =>
      Effect.gen(function* () {
        const committed = yield* commit(input);
        consumed = true;
        yield* Effect.promise(() => settled);
        return committed;
      }),
    );
    const sendCommand = () => ({
      type: "send" as const,
      channelId: "channel-1",
      operationId: operationId(),
      text: "Prepare the report",
      recipientAgentId: "agent-a",
      replyToMessageId: null,
      attachmentDraftIds: [attachment.id],
    });
    const sent = runChannel(service.command(sendCommand(), actor));
    await vi.waitFor(() => expect(consumed).toBe(true));
    await runChannel(service.command({ type: "archive", channelId: "channel-1", operationId: operationId() }, actor));
    release();
    await expect(sent).rejects.toThrow("Restore this channel before sending messages or changing tasks.");
    copy.mockRestore();
    await runChannel(service.command({ type: "restore", channelId: "channel-1", operationId: operationId() }, actor));
    await expect(runChannel(service.command(sendCommand(), actor))).resolves.toBeDefined();
  });

  it("gives the drafts back when the reply target is gone", async () => {
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
    if (!attachment) throw new Error("draft missing");
    const sendCommand = (replyToMessageId: string | null) => ({
      type: "send" as const,
      channelId: "channel-1",
      operationId: operationId(),
      text: "Prepare the report",
      recipientAgentId: "agent-a",
      replyToMessageId,
      attachmentDraftIds: [attachment.id],
    });
    await expect(runChannel(service.command(sendCommand("missing-message"), actor))).rejects.toThrow();
    await expect(runChannel(service.command(sendCommand(null), actor))).resolves.toBeDefined();
  });

  it("keeps memory and the database in step when giving the drafts back fails to save", async () => {
    allowReported = true;
    const file = join(root, "brief.txt");
    await writeFile(file, "the brief");
    const attachment = (await runChannel(data.mailbox.prepareAttachments([file])))[0];
    if (!attachment) throw new Error("draft missing");
    const database = data.store.database;
    const replace = database.replaceMailboxState.bind(database);
    vi.spyOn(database, "replaceMailboxState").mockImplementation((...args) => {
      if (args[2] === "channel.attachments-reverted") throw new Error("disk full");
      return replace(...args);
    });
    const sendCommand = (replyToMessageId: string | null) => ({
      type: "send" as const,
      channelId: "channel-1",
      operationId: operationId(),
      text: "Prepare the report",
      recipientAgentId: "agent-a",
      replyToMessageId,
      attachmentDraftIds: [attachment.id],
    });
    await expect(runChannel(service.command(sendCommand("missing-message"), actor))).rejects.toThrow();
    expect(reported).toHaveLength(1);
    // The restore was not saved, so the database still has the draft consumed. This process must
    // agree: a send that uses the draft now would be one that a restart cannot see.
    const persisted = data.store.database.readMailboxState();
    const drafts =
      persisted && typeof persisted === "object" && "drafts" in persisted && Array.isArray(persisted.drafts)
        ? persisted.drafts
        : null;
    expect(drafts).not.toBeNull();
    expect(
      drafts?.some(
        (draft: unknown) => typeof draft === "object" && draft !== null && "id" in draft && draft.id === attachment.id,
      ),
    ).toBe(false);
    await expect(runChannel(service.command(sendCommand(null), actor))).rejects.toThrow();
  });
});
