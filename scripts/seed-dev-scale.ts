// Scaled data for `bun run dev:seed --scale=...` and `bun run dev:bench`. The
// showcase seed holds four short conversations, which says nothing about a
// profile after months of use. This adds agents with long histories, busy
// channels and large images, written through the same public stores as the
// showcase so the app reads them back exactly as it reads its own writes.

import {
  type AgentSummary,
  type AttachmentSummary,
  AVATAR_HUES,
  type ChannelMessage,
  type ChannelTask,
  type ConversationMessage,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { strToU8, zlibSync } from "fflate";
import type { AgentStore } from "../src/backend/agent-store";
import { ChannelStore } from "../src/backend/channel-store";
import type { MailboxStore } from "../src/backend/mailbox-store";

export interface SeedScale {
  agents: number;
  // Per scaled agent.
  messages: number;
  channels: number;
  // Per scaled channel. Defaults to `messages`.
  channelMessages: number;
  // Large images, all in the first scaled agent's conversation.
  attachments: number;
}

export const NO_SCALE: SeedScale = { agents: 0, messages: 0, channels: 0, channelMessages: 0, attachments: 0 };

const SCALE_KEYS: readonly (keyof SeedScale)[] = ["agents", "messages", "channels", "channelMessages", "attachments"];

const SCALE_LIMITS: Record<keyof SeedScale, number> = {
  agents: 500,
  messages: 50_000,
  channels: 100,
  channelMessages: 50_000,
  attachments: 200,
};

/** Reads `agents:10,messages:2000,channels:5,attachments:20`. Unknown keys and bad counts throw. */
export function parseSeedScale(raw: string): SeedScale {
  const scale: SeedScale = { ...NO_SCALE };
  let channelMessagesSet = false;
  for (const part of raw.split(",")) {
    const [name, value, ...rest] = part.trim().split(":");
    if (!isOneOf(SCALE_KEYS, name) || value === undefined || rest.length > 0) {
      throw new Error(`--scale takes key:count pairs from ${SCALE_KEYS.join(", ")}; got "${part}".`);
    }
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0 || count > SCALE_LIMITS[name]) {
      throw new Error(`--scale ${name} must be an integer from 0 to ${SCALE_LIMITS[name]}; got "${value}".`);
    }
    scale[name] = count;
    if (name === "channelMessages") channelMessagesSet = true;
  }
  if (!channelMessagesSet) scale.channelMessages = scale.messages;
  if (scale.attachments > 0 && scale.agents === 0) {
    throw new Error("--scale attachments go into the first scaled agent, so agents must be at least 1.");
  }
  return scale;
}

export function scaleAgentId(index: number): string {
  return `scale-${String(index + 1).padStart(3, "0")}`;
}

export function scaleChannelId(index: number): string {
  return `scale-channel-${String(index + 1).padStart(3, "0")}`;
}

const TOPICS = [
  "the onboarding flow",
  "the billing export",
  "the search index",
  "the release checklist",
  "the sync protocol",
  "the settings page",
  "the crash report",
  "the pricing test",
];

// Replies of the shapes the renderer spends its time on: paragraphs, lists,
// inline code, links and fenced code in several languages. Deterministic, so
// two bench runs render the same bytes.
export function scaledReply(index: number): string {
  const topic = TOPICS[index % TOPICS.length] ?? "the plan";
  const paragraphs = [
    `## Notes on ${topic} (${index})`,
    "",
    `I read ${topic} again and compared it with the last report. The main change is in \`step ${index % 7}\`: ` +
      "it now waits for the write to finish before it returns, which removes the race we saw last week. " +
      "See [the design note](https://example.com/notes) for the full reasoning.",
    "",
    "- Keep the old path behind the flag until the next release.",
    `- Move the ${index % 3 === 0 ? "retry" : "timeout"} into one place.`,
    "- Add a test for the empty case.",
  ];
  if (index % 4 === 1) {
    paragraphs.push(
      "",
      "```ts",
      `export function step${index}(input: readonly number[]): number {`,
      "  let total = 0;",
      "  for (const value of input) {",
      "    if (value < 0) continue;",
      "    total += value * 2;",
      "  }",
      "  return total;",
      "}",
      "```",
    );
  }
  if (index % 6 === 3) {
    paragraphs.push(
      "",
      "| Case | Before | After |",
      "| --- | ---: | ---: |",
      `| cold | ${100 + (index % 50)} ms | ${60 + (index % 30)} ms |`,
      `| warm | ${40 + (index % 20)} ms | ${25 + (index % 10)} ms |`,
    );
  }
  return paragraphs.join("\n");
}

function scaledRequest(index: number): string {
  const topic = TOPICS[index % TOPICS.length] ?? "the plan";
  return `Check ${topic} again and tell me what changed since step ${index}.`;
}

function scaledMessages(prefix: string, count: number, now: number): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    const author = index % 2 === 0 ? "user" : "assistant";
    messages.push({
      id: `${prefix}-${index}`,
      author,
      source: author,
      text: author === "user" ? scaledRequest(index) : scaledReply(index),
      // One minute apart, ending an hour ago, in order.
      createdAt: new Date(now - 60 * 60_000 - (count - index) * 60_000).toISOString(),
      status: "completed",
    });
  }
  return messages;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(strToU8(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/**
 * An RGB PNG of the given size with a gradient and noise, so it neither
 * compresses to nothing nor decodes to less than a real photo would.
 */
export function largePng(width: number, height: number, seed: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let state = seed || 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      state = (state * 1_103_515_245 + 12_345) >>> 0;
      const noise = state >>> 27;
      const offset = row + 1 + x * 3;
      raw[offset] = ((x * 255) / width + noise) & 0xff;
      raw[offset + 1] = ((y * 255) / height + noise) & 0xff;
      raw[offset + 2] = (seed * 37 + noise) & 0xff;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibSync(raw, { level: 1 })),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

function scaledTask(
  channelId: string,
  taskId: string,
  requestMessageId: string,
  ownerAgentId: string,
  instruction: string,
): ChannelTask {
  return {
    id: taskId,
    channelId,
    parentTaskId: null,
    rootTaskId: taskId,
    ownerAgentId,
    requestMessageId,
    instruction,
    attachmentDraftIds: [],
    expectedResult: "Complete the requested work and report the result.",
    sourceMessageIds: [requestMessageId],
    dependencies: [],
    resources: ["host"],
    state: "completed",
    revision: 0,
    assignmentCount: 1,
    error: null,
  };
}

export interface ScaledSeedOptions {
  agentStore: AgentStore;
  mailbox: MailboxStore;
  scale: SeedScale;
  // The provider, model and effort every seeded agent shares.
  agentModel: Pick<AgentSummary, "provider" | "model" | "reasoningEffort">;
  // Members of the scaled channels: showcase agents, which always exist.
  channelMembers: readonly string[];
  now: number;
  transferDirectories: string[];
}

export async function seedScale(options: ScaledSeedOptions): Promise<void> {
  const { agentStore, mailbox, scale, agentModel, channelMembers, now, transferDirectories } = options;
  for (let index = 0; index < scale.agents; index += 1) {
    const agentId = scaleAgentId(index);
    const name = `Scale ${index + 1}`;
    await agentStore.getOrCreate(agentId, name, "Benchmark agent");
    await agentStore.updateAgent({
      agentId,
      name,
      title: "Benchmark agent",
      description: "Holds a long, generated conversation for resource benchmarks.",
      provider: agentModel.provider,
      model: agentModel.model,
      reasoningEffort: agentModel.reasoningEffort,
      avatarSeed: agentId,
      avatarHue: AVATAR_HUES[index % AVATAR_HUES.length] ?? null,
    });
    const threadId = await agentStore.ensureThreadId(agentId);
    const messages = scaledMessages(agentId, scale.messages, now);
    if (index === 0) {
      for (let image = 0; image < scale.attachments; image += 1) {
        const attachment: AttachmentSummary = await mailbox.storeGeneratedAttachment({
          name: `scale-image-${image + 1}.png`,
          mimeType: "image/png",
          bytes: largePng(2_400, 1_600, image + 1),
          ownerAgentId: agentId,
          ownerThreadId: threadId,
        });
        transferDirectories.push(`generated/${attachment.id}`);
        messages.push({
          id: `${agentId}-image-${image}`,
          author: "assistant",
          source: "assistant",
          text: `Image ${image + 1} of the generated set.`,
          createdAt: new Date(now - 30 * 60_000 + image * 1_000).toISOString(),
          status: "completed",
          attachments: [attachment],
        });
      }
    }
    agentStore.database.persistConversation(
      { agentId, threadId, activeTurnId: null, revision: 0, messages },
      "dev-seed.created",
      { seedVersion: 1, scaled: true },
      `dev-seed:scale-conversation:${agentId}`,
    );
  }
  const store = new ChannelStore(agentStore.database);
  for (let index = 0; index < scale.channels; index += 1) {
    const channelId = scaleChannelId(index);
    const [lead = "chief"] = channelMembers;
    let channel = store.update(
      store.create(channelId, {
        name: `Scale channel ${index + 1}`,
        title: "Generated benchmark history",
        instructions: "Answer briefly.",
        members: channelMembers.map((agentId) => ({ agentId })),
        leadAgentId: lead,
      }),
      {},
      `dev-seed:${channelId}`,
    );
    for (const agentId of channelMembers) store.context(channelId, agentId);
    const messages: ChannelMessage[] = [];
    const tasks: ChannelTask[] = [];
    for (let position = 0; position < scale.channelMessages; position += 1) {
      const id = `${channelId}-${position}`;
      const taskId = `${channelId}-task-${Math.floor(position / 2)}`;
      const fromMember = position % 2 === 0;
      const agentId = channelMembers[position % channelMembers.length] ?? lead;
      if (fromMember) tasks.push(scaledTask(channelId, taskId, id, agentId, scaledRequest(position)));
      const author: ChannelMessage["author"] = fromMember
        ? { kind: "member", id: "local", name: "You" }
        : { kind: "agent", id: agentId, name: agentId };
      messages.push({
        id,
        channelId,
        taskId,
        author,
        sequence: 0,
        superseded: false,
        message: {
          id,
          text: fromMember ? scaledRequest(position) : scaledReply(position),
          author: fromMember ? "user" : "assistant",
          createdAt: new Date(now - 60 * 60_000 - (scale.channelMessages - position) * 60_000).toISOString(),
          status: "completed",
          turnId: fromMember ? undefined : `${channelId}-turn-${position}`,
        },
      });
    }
    // In slices: one commit of thousands of messages is not what the app ever
    // writes, and it would hold one SQLite transaction for the whole channel.
    for (let start = 0; start < messages.length; start += 200) {
      const slice = messages.slice(start, start + 200);
      const sliceTasks = tasks.filter((task) => slice.some((message) => message.id === task.requestMessageId));
      channel = store.update(channel, { messages: slice, tasks: sliceTasks }, `dev-seed:${channelId}:${start}`);
    }
  }
}
