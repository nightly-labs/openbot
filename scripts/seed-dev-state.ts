import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type {
  AgentSummary,
  AttachmentSummary,
  ChannelMessage,
  ChannelTask,
  ConversationMessage,
  Routine,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { z } from "zod";
import { agentNamesById, displayMessageReferences } from "../src/backend/agent/delivery-content";
import { AgentMemoryStore } from "../src/backend/agent-memory-store";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { ChannelMemoryStore } from "../src/backend/channel-memory-store";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { ChannelStore } from "../src/backend/channel-store";
import { sortConversationMessages } from "../src/backend/conversation-snapshots";
import { MailboxStore } from "../src/backend/mailbox-store";
import { TeamChatStore } from "../src/backend/team-chat-store";
import { developmentUserDataName, readDevelopmentInstanceId } from "../src/main/development-profile";
import { writeSetupState } from "../src/main/setup-store";
import { TeamStore } from "../src/main/team-store";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";

export const DEVELOPMENT_SEED_MANIFEST_FILE = "openbot-dev-seed-v1.json";

const logger = createOpenBotLogger("seed-dev-state");

const TEAM_FILE = "openbot-team-server-v2.json";
/** Read only, exactly as the app reads it: the file a build without accounts owns. */
const LEGACY_TEAM_FILE = "openbot-team-server-v1.json";
const SETUP_FILE = "openbot-setup-v2.json";
const SEED_VERSION = 1;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CHANNEL_LAUNCH_ROOM = "channel-launch-room";
const CHANNEL_BETA_FEEDBACK = "channel-beta-feedback";
/**
 * The reader id `HostService.channelActor` uses while no account is signed in. The signed-in reader
 * adopts these cursors through `ChannelStore.adoptReads`, so the seeded read state follows it.
 */
const LOCAL_MEMBER_ID = "local";
const SEED_AGENT_MODEL = "gpt-5.6-luna";
const SEED_AGENT_REASONING_EFFORT = "low";
const GENERATED_DIRECTORY_PATTERN =
  /^generated\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHOWCASE_IMAGE_PATH = resolve(process.cwd(), "src", "renderer", "src", "assets", "openbot-logo-dev.png");

interface DevelopmentSeedManifest {
  version: 1;
  createdAt: string;
  transferDirectories: string[];
}

const developmentSeedManifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  transferDirectories: z.array(z.string()),
});

export interface DevelopmentSeedOptions {
  appDataRoot?: string;
  homeDirectory?: string;
  dryRun?: boolean;
  instanceId?: string | null;
}

export interface DevelopmentSeedSummary {
  targetProfile: string;
  dryRun: boolean;
  profileActive: boolean;
  agents: number;
  conversations: number;
  attachments: number;
  teamMembers: number;
  activeInvites: number;
  sessions: number;
  directThreads: number;
  queuedDeliveries: number;
  memories: number;
  routines: number;
  routineRuns: number;
  channels: number;
  channelMessages: number;
  channelTasks: number;
  channelMemories: number;
  channelRoutines: number;
  channelRoutineRuns: number;
}

const SEED_SUMMARY = {
  agents: 4,
  conversations: 4,
  attachments: 5,
  teamMembers: 4,
  activeInvites: 1,
  sessions: 4,
  directThreads: 3,
  queuedDeliveries: 0,
  memories: 7,
  routines: 5,
  routineRuns: 3,
  channels: 2,
  channelMessages: 12,
  channelTasks: 5,
  channelMemories: 3,
  channelRoutines: 2,
  channelRoutineRuns: 2,
} as const;

const AGENTS = [
  {
    id: "chief",
    name: "Chief",
    title: "Chief of staff",
    description: "Coordinates priorities, decisions, and handoffs across the team.",
    model: SEED_AGENT_MODEL,
    reasoningEffort: SEED_AGENT_REASONING_EFFORT,
    avatarHue: 245,
  },
  {
    id: "research",
    name: "Research",
    title: "Research partner",
    description: "Finds reliable sources and turns them into concise briefs.",
    model: SEED_AGENT_MODEL,
    reasoningEffort: SEED_AGENT_REASONING_EFFORT,
    avatarHue: 185,
  },
  {
    id: "builder",
    name: "Builder",
    title: "Product engineer",
    description: "Builds product changes and records clear technical decisions.",
    model: SEED_AGENT_MODEL,
    reasoningEffort: SEED_AGENT_REASONING_EFFORT,
    avatarHue: 30,
  },
  {
    id: "launch",
    name: "Launch",
    title: "Go-to-market lead",
    description: "Prepares launch assets, messaging, and release checklists.",
    model: SEED_AGENT_MODEL,
    reasoningEffort: SEED_AGENT_REASONING_EFFORT,
    avatarHue: 320,
  },
] as const;

export async function seedDevelopmentState(options: DevelopmentSeedOptions = {}): Promise<DevelopmentSeedSummary> {
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const appDataRoot = resolve(
    options.appDataRoot ?? resolveDevelopmentAppDataRoot(process.platform, process.env, homeDirectory),
  );
  assertSafeAppDataRoot(appDataRoot);
  const targetProfile = resolve(appDataRoot, developmentUserDataName("app", options.instanceId ?? null));
  if (dirname(targetProfile) !== appDataRoot) throw new Error(`Unsafe OpenBot dev profile path: ${targetProfile}`);

  const profileActive = await isDevelopmentProfileActive(targetProfile);
  const summary: DevelopmentSeedSummary = {
    targetProfile,
    dryRun: options.dryRun ?? false,
    profileActive,
    ...SEED_SUMMARY,
  };
  if (options.dryRun) return summary;
  if (profileActive) {
    throw new Error("Quit the OpenBot dev app before you seed its local state.");
  }

  await mkdir(appDataRoot, { recursive: true, mode: 0o700 });
  const stagingProfile = await mkdtemp(join(appDataRoot, ".openbot-dev-seed-"));
  const newTransferDirectories: string[] = [];
  try {
    await buildSeedProfile(stagingProfile, homeDirectory, newTransferDirectories);
    if (await isDevelopmentProfileActive(targetProfile)) {
      throw new Error("Quit the OpenBot dev app before you seed its local state.");
    }
    await replaceDevelopmentProfile(targetProfile, stagingProfile, homeDirectory);
  } catch (error) {
    await Promise.all([
      rm(stagingProfile, { recursive: true, force: true }),
      removeTransferDirectories(homeDirectory, newTransferDirectories),
    ]);
    throw error;
  }

  return summary;
}

export async function isDevelopmentProfileActive(profilePath: string): Promise<boolean> {
  const lockPath = join(profilePath, "SingletonLock");
  try {
    const lock = await lstat(lockPath);
    if (!lock.isSymbolicLink()) return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }

  let target: string;
  try {
    target = await readlink(lockPath);
  } catch {
    return true;
  }
  const processId = Number(target.match(/-(\d+)$/u)?.[1]);
  if (!Number.isSafeInteger(processId) || processId <= 0) return true;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

export async function cleanupSeedOwnedTransfers(profilePath: string, homeDirectory = homedir()): Promise<string[]> {
  const directories = await readSeedTransferDirectories(profilePath);
  return removeTransferDirectories(homeDirectory, directories);
}

async function buildSeedProfile(
  profilePath: string,
  homeDirectory: string,
  transferDirectories: string[],
): Promise<void> {
  const agentStore = new AgentStore(profilePath, homeDirectory);
  await agentStore.initialize();
  const mailbox = new MailboxStore(profilePath, agentStore.sharedRoot, agentStore.database);
  await mailbox.initialize();

  const clock = createSeedClock();
  try {
    const agents = await seedAgents(agentStore);
    const attachments = await seedAttachments(mailbox, agents, transferDirectories);
    seedMemories(agentStore);
    await seedRoutines(agentStore, mailbox, clock);
    await seedAgentExchanges(mailbox);
    await seedConversations(agentStore, mailbox, agents, attachments, clock);
    await seedChannels(agentStore, mailbox, agents, clock, transferDirectories);
    await seedTeam(profilePath, agentStore, clock);
    await writeSetupState(join(profilePath, SETUP_FILE), "codex");
    await writeSeedManifest(profilePath, clock, transferDirectories);
  } finally {
    agentStore.database.close();
  }
}

function seedMemories(agentStore: AgentStore): void {
  const memories = new AgentMemoryStore(agentStore.database);
  for (const fixture of [
    {
      agentId: "chief",
      text: "The user prefers concise status updates with clear owners and next steps.",
      origin: "manual" as const,
    },
    {
      agentId: "chief",
      text: "Use Europe/Warsaw when presenting launch dates and times.",
      origin: "manual" as const,
    },
    {
      agentId: "chief",
      text: "The current priority is a traceable OpenBot launch plan.",
      origin: "automatic" as const,
      sourceTurnId: "dev-seed-turn-chief-plan",
    },
    {
      agentId: "research",
      text: "Prioritize primary sources and call out claims that still need verification.",
      origin: "manual" as const,
    },
    {
      agentId: "research",
      text: "The launch evidence map contains one claim that still needs a primary source.",
      origin: "automatic" as const,
      sourceTurnId: "dev-seed-turn-research-evidence",
    },
    {
      agentId: "builder",
      text: "Implementation plans should include typecheck, tests, and a rollback step.",
      origin: "manual" as const,
    },
    {
      agentId: "launch",
      text: "Use calm, evidence-based release messaging and review final assets before publication.",
      origin: "manual" as const,
    },
  ]) {
    if (fixture.origin === "automatic") {
      memories.saveAutomatic({
        agentId: fixture.agentId,
        text: fixture.text,
        sourceTurnId: fixture.sourceTurnId,
      });
    } else {
      memories.createManual(fixture.agentId, fixture.text);
    }
  }
}

async function seedRoutines(agentStore: AgentStore, mailbox: MailboxStore, clock: SeedClock): Promise<void> {
  const routines = new AgentRoutineStore(agentStore.database);
  const timezone = seedTimezone();
  const now = clock.now;
  const morningBrief = routines.create(
    {
      agentId: "chief",
      name: "Morning launch brief",
      instruction: "Summarize launch progress, blockers, owners, and the next decision in five bullets.",
      active: true,
      timezone,
      schedule: { kind: "weekdays", time: "09:00" },
    },
    now,
  );
  const fridayReview = routines.create(
    {
      agentId: "chief",
      name: "Friday launch review",
      instruction: "Prepare the weekly launch review with decisions, risks, and unresolved ownership gaps.",
      active: true,
      timezone,
      schedule: { kind: "weekly", weekday: 5, time: "16:00" },
    },
    now,
  );
  const sourceCheck = routines.create(
    {
      agentId: "research",
      name: "Daily source check",
      instruction: "Recheck open launch claims against primary sources and report only material changes.",
      active: true,
      timezone,
      schedule: { kind: "daily", time: "08:30" },
    },
    now,
  );
  routines.create(
    {
      agentId: "builder",
      name: "Dependency health check",
      instruction: "Review dependency health and prepare a short risk report without changing the codebase.",
      active: false,
      timezone,
      schedule: { kind: "weekly", weekday: 1, time: "10:00" },
    },
    now,
  );
  routines.create(
    {
      agentId: "launch",
      name: "Release readiness pulse",
      instruction: "Check release assets, messaging, and approvals, then list anything blocking publication.",
      active: true,
      timezone,
      schedule: { kind: "weekdays", time: "15:30" },
    },
    now,
  );

  // Each run holds its own `scheduledFor`, but the request it delivers carries the mailbox clock,
  // which is the moment the seed runs. So two runs of one routine would render as one instruction
  // repeated at one time. Two routines keep the scheduled and the manual run apart in the thread.
  await seedRoutineRun(routines, mailbox, morningBrief, "scheduled", clock.at(26 * HOUR), "succeeded");
  await seedRoutineRun(routines, mailbox, fridayReview, "manual", clock.at(2 * HOUR), "succeeded");
  await seedRoutineRun(
    routines,
    mailbox,
    sourceCheck,
    "scheduled",
    clock.at(25 * HOUR),
    "failed",
    "One source was temporarily unavailable.",
  );
}

async function seedRoutineRun(
  routines: AgentRoutineStore,
  mailbox: MailboxStore,
  routine: Routine,
  kind: "scheduled" | "manual",
  scheduledFor: string,
  status: "succeeded" | "failed",
  error: string | null = null,
): Promise<void> {
  const run = routines.createRun(routine, kind === "scheduled" ? routine.trigger.id : null, kind, scheduledFor);
  const receipt = await mailbox.enqueue({
    sender: {
      kind: "routine",
      routineId: routine.id,
      runId: run.id,
      routineName: routine.name,
      scheduledFor,
    },
    recipientAgentIds: [routine.agentId],
    text: routine.instruction,
    idempotencyKey: `dev-seed:routine-run:${run.id}`,
  });
  const delivery = receipt.deliveries[0];
  if (!delivery) throw new Error("The seeded routine run did not create a delivery.");
  routines.attachDelivery(run.id, delivery.id);
  await mailbox.markStarting(delivery.id);
  await mailbox.markRunning(delivery.id, `dev-seed-routine-turn-${run.id}`);
  await mailbox.markTerminal(delivery.id, status === "succeeded" ? "completed" : "failed", error);
  routines.updateRunStatus(run.id, status, error);
}

async function seedAgents(agentStore: AgentStore): Promise<Map<string, AgentSummary>> {
  const agents = new Map<string, AgentSummary>();
  for (const fixture of AGENTS) {
    await agentStore.getOrCreate(fixture.id, fixture.name, fixture.title);
    const agent = await agentStore.updateAgent({
      agentId: fixture.id,
      name: fixture.name,
      title: fixture.title,
      description: fixture.description,
      model: fixture.model,
      reasoningEffort: fixture.reasoningEffort,
      avatarSeed: fixture.id,
      avatarHue: fixture.avatarHue,
    });
    await agentStore.ensureThreadId(fixture.id);
    agents.set(fixture.id, agentStore.list().find((candidate) => candidate.id === fixture.id) ?? agent);
  }
  return agents;
}

async function seedAttachments(
  mailbox: MailboxStore,
  agents: Map<string, AgentSummary>,
  transferDirectories: string[],
): Promise<Record<"brief" | "metrics" | "evidence" | "image", AttachmentSummary>> {
  const chief = requireAgent(agents, "chief");
  const research = requireAgent(agents, "research");
  const launch = requireAgent(agents, "launch");
  async function store(
    owner: AgentSummary,
    input:
      | { name: string; mimeType: string; bytes: Uint8Array }
      | { name: string; mimeType: string; sourcePath: string },
  ): Promise<AttachmentSummary> {
    const attachment = await mailbox.storeGeneratedAttachment({
      ...input,
      ownerAgentId: owner.id,
      ownerThreadId: owner.threadId,
    });
    transferDirectories.push(`generated/${attachment.id}`);
    return attachment;
  }

  return {
    brief: await store(chief, {
      name: "launch-brief.md",
      mimeType: "text/markdown",
      bytes: bytes("# Launch brief\n\n- Confirm owners\n- Verify evidence\n- Publish the release note\n"),
    }),
    metrics: await store(chief, {
      name: "launch-metrics.csv",
      mimeType: "text/csv",
      bytes: bytes("metric,baseline,target\nactivation,42%,55%\nretention,61%,68%\n"),
    }),
    evidence: await store(research, {
      name: "evidence-map.json",
      mimeType: "application/json",
      bytes: bytes(`${JSON.stringify({ sources: 8, verified: 7, needsReview: 1 }, null, 2)}\n`),
    }),
    image: await store(launch, {
      name: "openbot-launch-concept.png",
      mimeType: "image/png",
      sourcePath: SHOWCASE_IMAGE_PATH,
    }),
  };
}

async function seedConversations(
  agentStore: AgentStore,
  mailbox: MailboxStore,
  agents: Map<string, AgentSummary>,
  attachments: Record<"brief" | "metrics" | "evidence" | "image", AttachmentSummary>,
  clock: SeedClock,
): Promise<void> {
  const message = (id: string, author: ConversationMessage["author"], text: string, ago: number): ConversationMessage =>
    conversationMessage(clock, id, author, text, ago);
  const mention = (agentId: string): string => mentionAgent(agents, agentId);
  const file = (attachment: AttachmentSummary): string => serializeAttachmentReference(attachment.name, attachment.id);
  const conversations: Record<string, ConversationMessage[]> = {
    chief: [
      message(
        "chief-user-plan",
        "user",
        `Prepare the launch plan, tag ${mention("research")}, and keep every decision traceable.`,
        26 * HOUR,
      ),
      {
        ...message(
          "chief-assistant-plan",
          "assistant",
          [
            "## Launch plan",
            "",
            `I asked ${mention("research")} to verify the evidence. The working documents are`,
            `${file(attachments.brief)} and ${file(attachments.metrics)}.`,
            "",
            "| Workstream | Owner | Status |",
            "| --- | --- | --- |",
            `| Product QA | ${mention("builder")} | Ready |`,
            `| Evidence | ${mention("research")} | In review |`,
            `| Release | ${mention("launch")} | Ready |`,
            "",
            "Next: review the [OpenBot documentation](https://openbot.run/docs), then run:",
            "",
            "```bash",
            "bun run check",
            "```",
          ].join("\n"),
          26 * HOUR - 4 * MINUTE,
        ),
        turnId: "dev-seed-turn-chief-plan",
        attachments: [attachments.brief, attachments.metrics],
      },
      {
        ...message("chief-user-rollback", "user", "Who owns the rollback if the release note is wrong?", 25 * HOUR),
        replyToMessageId: "chief-assistant-plan",
      },
      message(
        "chief-assistant-rollback",
        "assistant",
        `${mention("builder")} owns the rollback. The steps are in the implementation checklist, and ${mention("launch")} holds publication until they pass.`,
        25 * HOUR - 3 * MINUTE,
      ),
      message("chief-user-image", "user", "Generate a banner concept for the launch post.", 6 * HOUR),
      {
        ...message("chief-image-completed", "assistant", "", 6 * HOUR - 2 * MINUTE),
        itemType: "image_generation",
        attachments: [attachments.image],
        imageGeneration: {
          prompt: "A calm OpenBot launch command center at blue hour",
          resolution: "1024 × 1024",
          aspectRatio: "square",
        },
      },
      message("chief-user-image-variant", "user", "Try a wide variant of the same concept.", 5 * HOUR),
      {
        ...message("chief-image-failed", "assistant", "", 5 * HOUR - MINUTE),
        status: "failed",
        itemType: "image_generation",
        imageGeneration: {
          prompt: "A second launch concept",
          resolution: "1536 × 1024",
          aspectRatio: "landscape",
          error: "The image service was temporarily unavailable.",
        },
      },
      message("chief-user-sources", "user", "Re-check the external sources in the brief before I share it.", 3 * HOUR),
      {
        ...message("chief-assistant-failed", "assistant", "I could not load one external source.", 3 * HOUR - MINUTE),
        status: "failed",
      },
      message("chief-user-audit", "user", "Run the full launch audit and stop if anything is unclear.", 95 * MINUTE),
      {
        ...message(
          "chief-assistant-interrupted",
          "assistant",
          "The long audit stopped when the app restarted.",
          92 * MINUTE,
        ),
        status: "interrupted",
      },
    ],
    research: [
      message("research-user", "user", "Check the launch claims and return a compact evidence map.", 27 * HOUR),
      {
        ...message(
          "research-assistant",
          "assistant",
          `Seven of eight claims are verified. One claim still needs a primary source. See ${file(attachments.evidence)}.`,
          27 * HOUR - 5 * MINUTE,
        ),
        turnId: "dev-seed-turn-research-evidence",
        attachments: [attachments.evidence],
      },
      message(
        "research-user-open-claim",
        "user",
        "Which claim is still open, and what would close it?",
        3 * HOUR + 30 * MINUTE,
      ),
      message(
        "research-assistant-open-claim",
        "assistant",
        "The retention claim is open. Only a vendor blog supports it. A primary source, or a measurement from our own data, would close it.",
        3 * HOUR + 28 * MINUTE,
      ),
    ],
    builder: [
      message("builder-user", "user", "Turn the launch plan into a safe implementation checklist.", 25 * HOUR),
      message(
        "builder-assistant",
        "assistant",
        "### Implementation checklist\n\n1. Run typecheck.\n2. Run Biome.\n3. Test the dev app.\n4. Record the rollback step.\n\n```ts\nconst ready = checks.every(Boolean);\n```",
        25 * HOUR - 10 * MINUTE,
      ),
      message("builder-user-rollback", "user", "Add the rollback step to the checklist and keep the order.", 4 * HOUR),
      message(
        "builder-assistant-rollback",
        "assistant",
        "The rollback step is now step five: revert the release tag, then republish the previous note. The order of the checks is unchanged.",
        4 * HOUR - 2 * MINUTE,
      ),
    ],
    launch: [
      message("launch-user", "user", "Prepare the final release message and asset review.", 23 * HOUR),
      {
        ...message(
          "launch-assistant",
          "assistant",
          `The release package is ready. Review ${file(attachments.image)} before publication.`,
          23 * HOUR - 5 * MINUTE,
        ),
        attachments: [attachments.image],
      },
      message(
        "launch-user-hold",
        "user",
        `Hold publication until ${mention("research")} closes the open claim.`,
        2 * HOUR,
      ),
      message(
        "launch-assistant-hold",
        "assistant",
        "Publication is on hold. The release note keeps the verified claims only, and I publish after the open claim is closed.",
        2 * HOUR - 3 * MINUTE,
      ),
    ],
  };

  const agentNames = agentNamesById([...agents.values()]);
  for (const [agentId, messages] of Object.entries(conversations)) {
    const agent = requireAgent(agents, agentId);
    const persistedMessages = [...messages, ...mailbox.conversationMessages(agentId)];
    sortConversationMessages(persistedMessages);
    agentStore.database.persistConversation(
      { agentId, threadId: agent.threadId, activeTurnId: null, revision: 0, messages: persistedMessages },
      "dev-seed.created",
      { seedVersion: SEED_VERSION },
      `dev-seed:conversation:${agentId}`,
    );
    // The app writes the preview from the user's last request with its references expanded
    // (`agent-service.ts`), never from a reply. A hand-written line contradicts the transcript
    // beside it as soon as the transcript changes.
    const request = [...messages].reverse().find((entry) => entry.author === "user" && entry.text.trim());
    if (request)
      await agentStore.updatePreview(
        agentId,
        displayMessageReferences(request.text, request.attachments ?? [], agentNames),
      );
  }
  await mailbox.setReaction("chief", "chief-assistant-plan", { kind: "user" }, "🎉");
  await mailbox.setReaction("research", "research-assistant", { kind: "user" }, "✅");
}

async function seedAgentExchanges(mailbox: MailboxStore): Promise<void> {
  const completed = await mailbox.enqueue({
    sender: { kind: "agent", agentId: "chief" },
    recipientAgentIds: ["research", "builder"],
    text: "Please verify the launch evidence and implementation checklist.",
    replyToMessageId: "chief-assistant-plan",
    idempotencyKey: "dev-seed:exchange:completed",
  });
  for (const [index, delivery] of completed.deliveries.entries()) {
    await mailbox.markStarting(delivery.id);
    await mailbox.markRunning(delivery.id, `dev-seed-turn-completed-${index + 1}`);
    await mailbox.markTerminal(delivery.id, "completed");
  }

  const failed = await mailbox.enqueue({
    sender: { kind: "agent", agentId: "research" },
    recipientAgentIds: ["launch"],
    text: "I could not verify the final launch claim. Please keep it out of the release note.",
    idempotencyKey: "dev-seed:exchange:failed",
  });
  const failedDelivery = failed.deliveries[0];
  if (!failedDelivery) throw new Error("The failed seed exchange did not create a delivery.");
  await mailbox.markStarting(failedDelivery.id);
  await mailbox.markRunning(failedDelivery.id, "dev-seed-turn-failed");
  await mailbox.markTerminal(failedDelivery.id, "failed", "The primary source was not available.");
}

/**
 * The two channels the app cannot show without them: a working room with a delegated run, and one
 * archived room behind the sidebar toggle. No seeded task is `queued` and no seeded routine run is
 * open, so the channel service recovers this state at startup without starting a provider turn.
 */
async function seedChannels(
  agentStore: AgentStore,
  mailbox: MailboxStore,
  agents: Map<string, AgentSummary>,
  clock: SeedClock,
  transferDirectories: string[],
): Promise<void> {
  const store = new ChannelStore(agentStore.database);
  await seedLaunchRoom(store, mailbox, agents, clock, transferDirectories);
  seedBetaFeedbackChannel(store, agents, clock);
}

async function seedLaunchRoom(
  store: ChannelStore,
  mailbox: MailboxStore,
  agents: Map<string, AgentSummary>,
  clock: SeedClock,
  transferDirectories: string[],
): Promise<void> {
  const channelId = CHANNEL_LAUNCH_ROOM;
  const created = store.update(
    {
      ...store.create(channelId, {
        name: "Launch room",
        title: "Ship OpenBot 1.0",
        instructions:
          "Keep every decision traceable. Name the owner and the evidence in each result, and leave an unverified claim out.",
        members: [{ agentId: "chief" }, { agentId: "research" }, { agentId: "builder" }, { agentId: "launch" }],
        leadAgentId: "chief",
      }),
      createdAt: clock.at(3 * DAY),
    },
    {},
    "dev-seed:channel-launch-room",
  );
  // The execution threads come first: a file an agent generates in a channel belongs to the shared
  // transcript, so it has to be owned by the channel thread rather than by the agent's own chat.
  for (const agentId of ["chief", "research", "builder"]) store.context(channelId, agentId);
  const launchThread = store.context(channelId, "launch").threadId;
  const draft = await mailbox.storeGeneratedAttachment({
    name: "release-note-draft.md",
    mimeType: "text/markdown",
    bytes: bytes(
      [
        "# OpenBot 1.0 release note (draft)",
        "",
        "## What is new",
        "- Channels: several agents share one chat and one task list.",
        "- Routines: a schedule can start work in a channel.",
        "",
        "## Evidence",
        "- Cold start: 1.9 s on the release benchmark. Owner: Builder.",
        "- Search: 120 ms median on the release benchmark. Owner: Builder.",
        "",
        "## Open",
        "- The retention claim has no primary source. It stays out of this note.",
        "",
      ].join("\n"),
    ),
    ownerAgentId: "launch",
    ownerThreadId: launchThread,
  });
  transferDirectories.push(`generated/${draft.id}`);

  // The routine exists before the message it fired: the author id of a routine request carries the
  // routine id, the way `ChannelService` writes it for a `request` command.
  const routines = new ChannelRoutineStore(store.database);
  const timezone = seedTimezone();
  const standup = routines.create(
    {
      channelId,
      name: "Daily launch standup",
      instruction: "Post the launch standup: progress since yesterday, blockers, and the next decision.",
      active: true,
      timezone,
      schedule: { kind: "weekdays", time: "09:15" },
    },
    clock.now,
  );
  routines.create(
    {
      channelId,
      name: "Weekly launch retro",
      instruction: "Collect what changed this week, what slipped, and one improvement for the next release.",
      active: false,
      timezone,
      schedule: { kind: "weekly", weekday: 5, time: "16:30" },
    },
    clock.now,
  );

  const requestReleaseNote = "channel-launch-request-release-note";
  const requestStandup = "channel-launch-request-standup";
  const requestRollback = "channel-launch-request-rollback";
  const taskReleaseNote = "channel-launch-task-release-note";
  const taskEvidence = "channel-launch-task-evidence";
  const taskStandup = "channel-launch-task-standup";
  const taskRollback = "channel-launch-task-rollback";
  const releaseNoteText =
    "Draft the release note for OpenBot 1.0. Keep the evidence with every claim and name an owner for each section.";
  const evidenceText = "Verify the two performance claims in the draft and name a primary source for each.";
  const rollbackText = `Add the rollback owner to the release note. ${mentionAgent(agents, "builder")} should confirm the steps.`;
  const message = (input: SeedChannelMessage): ChannelMessage => channelMessage(channelId, clock, input);
  const agentAuthor = (agentId: string): ChannelMessage["author"] => ({
    kind: "agent",
    id: agentId,
    name: requireAgent(agents, agentId).name,
  });

  const messages: ChannelMessage[] = [
    message({
      id: requestReleaseNote,
      taskId: taskReleaseNote,
      author: { kind: "member", id: LOCAL_MEMBER_ID, name: "You" },
      text: releaseNoteText,
      ago: 2 * DAY,
    }),
    message({
      id: "channel-launch-dispatch-release-note",
      taskId: taskReleaseNote,
      author: agentAuthor("chief"),
      text: "Assigned to Launch.",
      ago: 2 * DAY - 2 * MINUTE,
    }),
    message({
      id: "channel-launch-handoff-evidence",
      taskId: taskReleaseNote,
      author: agentAuthor("launch"),
      text: `Research: ${evidenceText}`,
      replyToMessageId: requestReleaseNote,
      ago: 2 * DAY - 6 * MINUTE,
    }),
    message({
      id: "channel-launch-result-evidence",
      taskId: taskEvidence,
      author: agentAuthor("research"),
      text: "Both performance claims match the release benchmark. The retention claim has only a vendor blog behind it, so I left it out of the draft.",
      turnId: "dev-seed-turn-channel-evidence",
      ago: 2 * DAY - 42 * MINUTE,
    }),
    message({
      id: "channel-launch-result-release-note",
      taskId: taskReleaseNote,
      author: agentAuthor("launch"),
      text: `The draft is ready: ${serializeAttachmentReference(draft.name, draft.id)}. It cites the two verified claims and names an owner for each section.`,
      turnId: "dev-seed-turn-channel-release-note",
      attachments: [draft],
      ago: 2 * DAY - 55 * MINUTE,
    }),
    message({
      id: requestStandup,
      taskId: taskStandup,
      author: { kind: "member", id: `routine:${standup.id}`, name: standup.name },
      text: standup.instruction,
      ago: 26 * HOUR,
    }),
    message({
      id: "channel-launch-result-standup",
      taskId: taskStandup,
      author: agentAuthor("chief"),
      text: "Progress: the release note draft is ready. Blocker: the retention claim has no primary source. Next decision: publish without the claim, or wait for the source.",
      turnId: "dev-seed-turn-channel-standup",
      ago: 26 * HOUR - 4 * MINUTE,
    }),
    message({
      id: requestRollback,
      taskId: taskRollback,
      author: { kind: "member", id: LOCAL_MEMBER_ID, name: "You" },
      text: rollbackText,
      ago: 3 * HOUR,
    }),
    message({
      id: "channel-launch-dispatch-rollback",
      taskId: taskRollback,
      author: agentAuthor("chief"),
      text: "Assigned to Builder.",
      ago: 3 * HOUR - 2 * MINUTE,
    }),
  ];
  const tasks: ChannelTask[] = [
    channelTask(channelId, {
      id: taskReleaseNote,
      ownerAgentId: "launch",
      requestMessageId: requestReleaseNote,
      instruction: releaseNoteText,
      state: "completed",
      dependencies: [taskEvidence],
      assignmentCount: 1,
    }),
    channelTask(channelId, {
      id: taskEvidence,
      parentTaskId: taskReleaseNote,
      rootTaskId: taskReleaseNote,
      ownerAgentId: "research",
      requestMessageId: requestReleaseNote,
      instruction: evidenceText,
      expectedResult: "Name the primary source of each verified claim, or report the claim as open.",
      state: "completed",
    }),
    channelTask(channelId, {
      id: taskStandup,
      ownerAgentId: "chief",
      requestMessageId: requestStandup,
      instruction: standup.instruction,
      state: "completed",
    }),
    channelTask(channelId, {
      id: taskRollback,
      ownerAgentId: "builder",
      requestMessageId: requestRollback,
      instruction: rollbackText,
      state: "failed",
      error: "The agent could not complete this task.",
    }),
  ];
  store.update(created, { messages, tasks }, "dev-seed:channel-launch-room:transcript");
  // Two messages the user did not write stay unread, so the sidebar count and the unread divider
  // both have something to show.
  store.markRead(channelId, LOCAL_MEMBER_ID, 6, "dev-seed:channel-launch-room:read");

  const standupRun = routines.createRun(standup, standup.trigger.id, "scheduled", clock.at(26 * HOUR));
  routines.attachRequest(standupRun.id, requestStandup);
  routines.updateRunStatus(standupRun.id, "succeeded");
  // A fire that never reached the channel: the run holds the error and no request message.
  const blockedRun = routines.createRun(standup, null, "manual", clock.at(4 * HOUR));
  routines.updateRunStatus(blockedRun.id, "failed", "Every member was busy when the routine fired.");

  const memories = new ChannelMemoryStore(store.database);
  memories.createManual(channelId, "Name the owner and the evidence for every release claim.");
  memories.createManual(channelId, "Use Europe/Warsaw when presenting launch dates and times.");
  memories.saveFromTool(
    channelId,
    "The retention claim has no primary source, so it stays out of the release note.",
    "dev-seed-turn-channel-evidence",
    "dev-seed:channel-memory:retention-claim",
  );
}

/** Finished work behind the sidebar's archived toggle, which is empty without it. */
function seedBetaFeedbackChannel(store: ChannelStore, agents: Map<string, AgentSummary>, clock: SeedClock): void {
  const channelId = CHANNEL_BETA_FEEDBACK;
  const created = store.update(
    {
      ...store.create(channelId, {
        name: "Beta feedback",
        title: "Read the beta reports",
        instructions: "Report counts, not impressions. Name the source of every number.",
        members: [{ agentId: "research" }, { agentId: "launch" }],
        leadAgentId: "launch",
      }),
      createdAt: clock.at(12 * DAY),
    },
    {},
    "dev-seed:channel-beta-feedback",
  );
  store.context(channelId, "research");
  const requestSummary = "channel-beta-request-summary";
  const taskSummary = "channel-beta-task-summary";
  const summaryText = "Summarize the beta feedback and list the three most common requests.";
  const messages: ChannelMessage[] = [
    channelMessage(channelId, clock, {
      id: requestSummary,
      taskId: taskSummary,
      author: { kind: "member", id: LOCAL_MEMBER_ID, name: "You" },
      text: summaryText,
      ago: 8 * DAY,
    }),
    channelMessage(channelId, clock, {
      id: "channel-beta-dispatch-summary",
      taskId: taskSummary,
      author: { kind: "agent", id: "launch", name: requireAgent(agents, "launch").name },
      text: "Assigned to Research.",
      ago: 8 * DAY - 2 * MINUTE,
    }),
    channelMessage(channelId, clock, {
      id: "channel-beta-result-summary",
      taskId: taskSummary,
      author: { kind: "agent", id: "research", name: requireAgent(agents, "research").name },
      text: "Ninety-four reports. The three most common requests are a shared inbox, faster search, and per-agent notification control.",
      turnId: "dev-seed-turn-channel-beta",
      ago: 8 * DAY - 35 * MINUTE,
    }),
  ];
  store.update(
    created,
    {
      messages,
      tasks: [
        channelTask(channelId, {
          id: taskSummary,
          ownerAgentId: "research",
          requestMessageId: requestSummary,
          instruction: summaryText,
          state: "completed",
        }),
      ],
    },
    "dev-seed:channel-beta-feedback:transcript",
  );
  store.markRead(channelId, LOCAL_MEMBER_ID, messages.length, "dev-seed:channel-beta-feedback:read");
  store.update({ ...store.get(channelId), archived: true }, {}, "dev-seed:channel-beta-feedback:archive");
}

interface SeedChannelMessage {
  id: string;
  taskId: string;
  author: ChannelMessage["author"];
  text: string;
  ago: number;
  turnId?: string;
  replyToMessageId?: string;
  attachments?: AttachmentSummary[];
}

/**
 * The same message shape `ChannelService` writes: a member request is a `user` message, a lead
 * dispatch or a handoff is a `system` message, and a reported result is an `assistant` message
 * with the turn that produced it.
 */
function channelMessage(channelId: string, clock: SeedClock, input: SeedChannelMessage): ChannelMessage {
  return {
    id: input.id,
    channelId,
    taskId: input.taskId,
    author: input.author,
    sequence: 0,
    superseded: false,
    message: {
      id: input.id,
      text: input.text,
      author: input.author.kind === "member" ? "user" : input.turnId ? "assistant" : "system",
      createdAt: clock.at(input.ago),
      status: "completed",
      turnId: input.turnId,
      replyToMessageId: input.replyToMessageId,
      attachments: input.attachments,
    },
  };
}

interface SeedChannelTask {
  id: string;
  ownerAgentId: string;
  requestMessageId: string;
  instruction: string;
  state: ChannelTask["state"];
  parentTaskId?: string;
  rootTaskId?: string;
  expectedResult?: string;
  dependencies?: string[];
  assignmentCount?: number;
  error?: string;
}

function channelTask(channelId: string, input: SeedChannelTask): ChannelTask {
  return {
    id: input.id,
    channelId,
    parentTaskId: input.parentTaskId ?? null,
    rootTaskId: input.rootTaskId ?? input.id,
    ownerAgentId: input.ownerAgentId,
    requestMessageId: input.requestMessageId,
    instruction: input.instruction,
    attachmentDraftIds: [],
    expectedResult: input.expectedResult ?? "Complete the requested work and report the result.",
    sourceMessageIds: [input.requestMessageId],
    dependencies: input.dependencies ?? [],
    resources: ["host"],
    state: input.state,
    revision: 0,
    assignmentCount: input.assignmentCount ?? 0,
    error: input.error ?? null,
  };
}

function mentionAgent(agents: Map<string, AgentSummary>, agentId: string): string {
  return serializeChatTagReference("agent", requireAgent(agents, agentId).name, agentId);
}

async function seedTeam(profilePath: string, agentStore: AgentStore, clock: SeedClock): Promise<void> {
  const team = new TeamStore(join(profilePath, TEAM_FILE), join(profilePath, LEGACY_TEAM_FILE));
  await team.initialize();
  const owner = {
    id: "openbot-dev-owner",
    email: "openbot-dev-host@example.com",
    name: "Dev Owner",
    avatarUrl: null,
  };
  const teamIdentity = await team.configureWithAccount("OpenBot Dev Team", owner);
  const joined = [];
  for (const member of [
    { id: "openbot-dev-alice", email: "alice@example.com", name: "Alice Chen", role: "admin" as const },
    { id: "openbot-dev-jon", email: "jon@example.com", name: "Jon Bell", role: "member" as const },
    { id: "openbot-dev-maya", email: "maya@example.com", name: "Maya Singh", role: "member" as const },
  ]) {
    const invite = await team.createInvite(member.role, member.email);
    joined.push(
      await team.acceptInviteWithAccount(invite.token, {
        id: member.id,
        email: member.email,
        name: member.name,
        avatarUrl: null,
      }),
    );
  }
  await team.createInvite("member", "new-person@example.com");
  const ownerSession = await team.loginWithAccount(owner);
  await team.setEnabledOnLaunch(teamIdentity.serverId, true);

  const [alice, jon, maya] = joined;
  if (!alice || !jon || !maya) throw new Error("The development team members could not be created.");
  const chat = new TeamChatStore(agentStore.database);
  chat.sendMessage({
    clientMessageId: "dev-seed-dm-owner-alice-1",
    senderMemberId: ownerSession.member.id,
    recipientMemberId: alice.member.id,
    text: "I added the launch notes. Can you review the last section?",
    createdAt: clock.at(3 * HOUR),
  });
  chat.sendMessage({
    clientMessageId: "dev-seed-dm-alice-owner-1",
    senderMemberId: alice.member.id,
    recipientMemberId: ownerSession.member.id,
    text: "The notes look good. I left one comment on the rollout section.",
    createdAt: clock.at(2 * HOUR + 40 * MINUTE),
  });
  chat.sendMessage({
    clientMessageId: "dev-seed-dm-jon-owner-1",
    senderMemberId: jon.member.id,
    recipientMemberId: ownerSession.member.id,
    text: "The customer examples are ready for the release note.",
    createdAt: clock.at(2 * HOUR),
  });
  chat.sendMessage({
    clientMessageId: "dev-seed-dm-maya-owner-1",
    senderMemberId: maya.member.id,
    recipientMemberId: ownerSession.member.id,
    text: "I checked the final asset sizes. Everything is within the limits.",
    createdAt: clock.at(35 * MINUTE),
  });
}

async function replaceDevelopmentProfile(target: string, staging: string, homeDirectory: string): Promise<void> {
  const backup = resolve(dirname(target), `.openbot-dev-backup-${randomUUID()}`);
  const targetExists = await pathExists(target);
  if (targetExists) await rename(target, backup);
  try {
    await rename(staging, target);
  } catch (error) {
    if (targetExists) await rename(backup, target);
    throw error;
  }
  if (!targetExists) return;
  try {
    await cleanupSeedOwnedTransfers(backup, homeDirectory);
  } catch (error) {
    logger.warn(`The new seed is ready, but old seed files could not be removed: ${errorMessage(error)}`);
  } finally {
    await rm(backup, { recursive: true, force: true }).catch((error: unknown) => {
      logger.warn(`The new seed is ready, but its temporary backup could not be removed: ${errorMessage(error)}`);
    });
  }
}

async function writeSeedManifest(profilePath: string, clock: SeedClock, transferDirectories: string[]): Promise<void> {
  const manifest: DevelopmentSeedManifest = {
    version: 1,
    createdAt: clock.at(0),
    transferDirectories: [...transferDirectories],
  };
  await writeFile(join(profilePath, DEVELOPMENT_SEED_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function readSeedTransferDirectories(profilePath: string): Promise<string[]> {
  try {
    const parsed = developmentSeedManifestSchema.safeParse(
      JSON.parse(await readFile(join(profilePath, DEVELOPMENT_SEED_MANIFEST_FILE), "utf8")),
    );
    if (!parsed.success) return [];
    return parsed.data.transferDirectories.filter((entry) => GENERATED_DIRECTORY_PATTERN.test(entry));
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function removeTransferDirectories(homeDirectory: string, directories: string[]): Promise<string[]> {
  const root = resolve(homeDirectory, "OpenBot", "Shared", "Transfers");
  const generatedRoot = resolve(root, "generated");
  const removed: string[] = [];
  for (const relativePath of directories) {
    if (!GENERATED_DIRECTORY_PATTERN.test(relativePath)) continue;
    const target = resolve(root, ...relativePath.split("/"));
    if (dirname(target) !== generatedRoot) continue;
    if (!(await pathExists(target))) continue;
    await rm(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}

/**
 * Every seeded record is dated backwards from the run. A fixed date would put the whole showcase
 * weeks before the routine runs, which the schedulers date from the real clock, and would make the
 * date separators and the sidebar order read wrong on the day a developer seeds.
 */
interface SeedClock {
  now: Date;
  at(millisecondsAgo: number): string;
}

function createSeedClock(now = new Date()): SeedClock {
  return { now, at: (millisecondsAgo) => new Date(now.getTime() - millisecondsAgo).toISOString() };
}

function seedTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function conversationMessage(
  clock: SeedClock,
  id: string,
  author: ConversationMessage["author"],
  text: string,
  millisecondsAgo: number,
): ConversationMessage {
  return {
    id,
    author,
    source: author === "assistant" ? "assistant" : author,
    text,
    createdAt: clock.at(millisecondsAgo),
    status: "completed",
  };
}

function requireAgent(agents: Map<string, AgentSummary>, agentId: string): AgentSummary {
  const agent = agents.get(agentId);
  if (!agent?.threadId) throw new Error(`Seed agent ${agentId} does not have a thread.`);
  return agent;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function assertSafeAppDataRoot(appDataRoot: string): void {
  if (appDataRoot === parse(appDataRoot).root) {
    throw new Error("The application data root cannot be a filesystem root.");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href;
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const summary = await seedDevelopmentState({
    dryRun,
    instanceId: readDevelopmentInstanceId(process.env.OPENBOT_DEV_INSTANCE_ID),
  });
  logger.info(dryRun ? "OpenBot development seed dry run:" : "OpenBot development state seeded:");
  logger.info(`- profile: ${summary.targetProfile}`);
  logger.info(`- profile active: ${summary.profileActive ? "yes" : "no"}`);
  logger.info(`- agents: ${summary.agents}`);
  logger.info(`- conversations: ${summary.conversations}`);
  logger.info(`- managed attachments: ${summary.attachments}`);
  logger.info(`- team members: ${summary.teamMembers}`);
  logger.info(`- active invites: ${summary.activeInvites}`);
  logger.info(`- direct threads: ${summary.directThreads}`);
  logger.info(`- queued deliveries: ${summary.queuedDeliveries}`);
  logger.info(`- memories: ${summary.memories}`);
  logger.info(`- routines: ${summary.routines}`);
  logger.info(`- routine runs: ${summary.routineRuns}`);
  logger.info(`- channels: ${summary.channels}`);
  logger.info(`- channel messages: ${summary.channelMessages}`);
  logger.info(`- channel tasks: ${summary.channelTasks}`);
  logger.info(`- channel memories: ${summary.channelMemories}`);
  logger.info(`- channel routines: ${summary.channelRoutines}`);
  logger.info(`- channel routine runs: ${summary.channelRoutineRuns}`);
  if (dryRun) logger.info("No files were changed.");
  else logger.info("Run `bun run dev` to open the seeded showcase.");
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    logger.error(toLogValue(error));
    process.exitCode = 1;
  });
}
