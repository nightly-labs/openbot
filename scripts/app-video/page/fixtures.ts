// The data that the app shows in the video: the team, the morning's messages, and the turns that
// the director plays. The app renders all of it through its preview mock. The video is English-only.

import type {
  AccountUsage,
  AgentSummary,
  AttachmentSummary,
  ConversationMessage,
  ConversationSnapshot,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { APP_CLOCK_START } from "../cues";

/** An ISO time `minutes` before the app clock starts. */
function before(minutes: number): string {
  return new Date(APP_CLOCK_START - minutes * 60_000).toISOString();
}

function agent(
  id: string,
  provider: AgentSummary["provider"],
  model: string,
  name: string,
  title: string,
  avatarHue: AgentSummary["avatarHue"],
  preview: string,
  minutesAgo: number,
): AgentSummary {
  return {
    id,
    provider,
    name,
    title,
    description: title,
    notifications: true,
    model,
    reasoningEffort: "medium",
    threadId: `thread-${id}`,
    workspacePath: `/Users/alex/OpenBot/Agents/${id}`,
    preview,
    updatedAt: before(minutesAgo),
    avatarSeed: id,
    avatarHue,
    avatarUrl: null,
  };
}

export const AGENTS: AgentSummary[] = [
  agent("chief", "claude", "claude-opus-5-5", "Chief", "Chief of staff", 245, "388 signups overnight.", 41),
  agent("research", "codex", "gpt-5.6-luna", "Research", "Research partner", 185, "Sources are in the brief.", 95),
  agent("builder", "codex", "gpt-5.6-terra", "Builder", "Product engineer", 30, "Staging is green.", 130),
  agent("design", "grok", "grok-4.6", "Design", "Brand designer", 320, "New hero images are ready.", 220),
  agent("support", "claude", "claude-sonnet-5", "Support", "Customer support", 150, "Inbox is at zero.", 300),
];

function message(
  id: string,
  author: "user" | "assistant",
  minutesAgo: number,
  text: string,
  attachments?: AttachmentSummary[],
): ConversationMessage {
  return {
    id,
    author,
    source: author,
    text,
    createdAt: before(minutesAgo),
    status: "completed",
    ...(attachments ? { attachments } : {}),
  };
}

const CHIEF_HISTORY: ConversationMessage[] = [
  message("chief-launch", "user", 17 * 60 + 20, "Can you draft the beta launch email for tomorrow?"),
  message(
    "chief-launch-answer",
    "assistant",
    17 * 60 + 18,
    [
      "Here is the draft. It is short, with one link to the waitlist.",
      "",
      "- **Subject:** Your AI team is ready",
      "- **Send:** 9:00 in each time zone",
    ].join("\n"),
    [file("launch-email", "launch-email.md", 1_840, "text/markdown")],
  ),
  message("chief-yesterday", "user", 16 * 60, "Looks good. Keep an eye on the beta signups tonight."),
  message("chief-yesterday-answer", "assistant", 16 * 60 - 1, "Will do. I will post a summary here at 9:00."),
  message(
    "chief-morning",
    "assistant",
    41,
    [
      "Good morning. **388 signups** overnight, and two teams asked about team pricing.",
      "",
      "- Builder fixed the waitlist form.",
      "- Design has new hero images.",
      "- Support answered every message.",
    ].join("\n"),
    [file("signups", "signups.csv", 18_400, "text/csv")],
  ),
];

const RESEARCH_HISTORY: ConversationMessage[] = [
  message("research-brief", "user", 26 * 60, "Collect sources on how small teams buy AI tools."),
  message(
    "research-brief-answer",
    "assistant",
    95,
    [
      "The brief is ready. **14 sources**, most from this year.",
      "",
      "- Teams start with one seat, then add seats in the first month.",
      "- Price per seat matters more than usage limits.",
    ].join("\n"),
    [file("buying-brief", "buying-brief.pdf", 412_000, "application/pdf")],
  ),
];

const HISTORY: Record<string, ConversationMessage[]> = { chief: CHIEF_HISTORY, research: RESEARCH_HISTORY };

export const SNAPSHOTS: Record<string, ConversationSnapshot> = Object.fromEntries(
  AGENTS.map((summary) => [
    summary.id,
    {
      agentId: summary.id,
      threadId: summary.threadId,
      activeTurnId: null,
      revision: 1,
      messages: HISTORY[summary.id] ?? [],
    },
  ]),
);

export const UPDATE_STATUS: UpdateStatus = {
  phase: "up-to-date",
  currentVersion: "0.2.0",
  availableVersion: null,
  progress: null,
  checkedAt: before(5),
  message: null,
  errorCode: null,
};

/** Plenty of plan left, so no usage warning shows. */
export const USAGE: AccountUsage = {
  limits: [
    { id: "claude", primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: null }, secondary: null },
    { id: "codex", primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: null }, secondary: null },
    { id: "grok", primary: null, secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: null } },
  ],
};

export const USER = { id: "user-alex", email: "alex@example.com", name: "Alex Rivera", avatarUrl: null };

function file(id: string, name: string, size: number, mimeType: string): AttachmentSummary {
  return { id, name, size, kind: "file", mimeType, previewKind: "text", previewUrl: null };
}

/** One agent turn: two thinking steps, then an answer that streams in, then optional handoffs. */
export interface ScriptedTurn {
  agentId: string;
  thinking: string[];
  answer: string;
  attachments: AttachmentSummary[];
  handoffTo: string[];
}

export const CHIEF_TURN: ScriptedTurn = {
  agentId: "chief",
  thinking: ["Reading pricing.md and last night's signup notes.", "Splitting the work between @Research and @Builder."],
  answer: [
    "## Team pricing plan",
    "",
    "I asked @Research for competitor prices and @Builder for the rollout.",
    "",
    "| Work | Owner | Due |",
    "| --- | --- | --- |",
    "| Tiers and copy | @Chief | Wed |",
    "| Price evidence | @Research | Thu |",
    "| Page and rollout | @Builder | Fri |",
    "",
    "I will post the page here for your review on Friday.",
  ].join("\n"),
  attachments: [file("pricing-plan", "pricing-plan.md", 3_412, "text/markdown")],
  handoffTo: ["research", "builder"],
};

export const RESEARCH_REQUEST =
  "Find what six competitors charge per seat for teams. Put the evidence in a CSV for the pricing page.";

export const RESEARCH_TURN: ScriptedTurn = {
  agentId: "research",
  thinking: ["Opening six pricing pages and their archived versions."],
  answer: [
    "Done. **5 of 6** competitors charge per seat; the median is **$18** a month.",
    "",
    "- Two dropped their free tier this year.",
    "- Annual billing saves 15 to 20%.",
    "",
    "@Chief, the evidence is in the CSV.",
  ].join("\n"),
  attachments: [file("price-evidence", "price-evidence.csv", 2_160, "text/csv")],
  handoffTo: ["chief"],
};
