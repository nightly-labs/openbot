import type { AttachmentKind, AttachmentPreviewKind } from "@openbot/contracts/ipc";
import type {
  AgentStorageRow,
  ConversationStorageRow,
  StorageBreakdown,
  StoredFileRow,
  StoredFileSource,
  StoredFileStatus,
} from "@openbot/ui/features/files/files-view";
import { STORY_AGENTS } from "./fixtures";

/** The fixed clock of every Files story, so "Today" and "Yesterday" do not move with the run date. */
export const FILES_NOW = new Date("2026-09-23T15:00:00");

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export const FILES_AGENTS = STORY_AGENTS;

export const FILES_CONVERSATIONS: ConversationStorageRow[] = [
  {
    id: "c-launch",
    title: "Launch plan and release notes",
    agentId: "chief",
    bytes: 486 * MB,
    fileCount: 14,
    messageCount: 312,
  },
  {
    id: "c-brand",
    title: "Brand images for the autumn campaign",
    agentId: "chief",
    bytes: 318 * MB,
    fileCount: 22,
    messageCount: 96,
  },
  {
    id: "c-sources",
    title: "Source check for the pricing brief",
    agentId: "research",
    bytes: 142 * MB,
    fileCount: 9,
    messageCount: 188,
  },
  {
    id: "c-interviews",
    title: "Customer interview recordings",
    agentId: "research",
    bytes: 97 * MB,
    fileCount: 4,
    messageCount: 41,
  },
  {
    id: "c-prospects",
    title: "Prospect list for the Nordics",
    agentId: "sales",
    bytes: 38 * MB,
    fileCount: 6,
    messageCount: 77,
  },
  { id: "c-followups", title: "Follow-up drafts", agentId: "sales", bytes: 4 * MB, fileCount: 1, messageCount: 23 },
  { id: "c-weekly", title: "Weekly review", agentId: "chief", bytes: 2 * MB, fileCount: 0, messageCount: 58 },
];

function conversation(id: string) {
  const found = FILES_CONVERSATIONS.find((entry) => entry.id === id);
  return found ? { id: found.id, title: found.title } : null;
}

/** A small gradient image, so image rows show a real thumbnail without a network request. */
function thumbnail(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><circle cx="28" cy="13" r="5" fill="rgba(255,255,255,0.55)"/><path d="M0 40 L14 22 L24 32 L30 26 L40 36 V40 Z" fill="rgba(0,0,0,0.3)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const MIME: Record<string, string> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
  m4a: "audio/mp4",
  md: "text/markdown",
  mov: "video/quicktime",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  py: "text/x-python",
  ts: "text/typescript",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  html: "text/html",
};

interface FileSeed {
  name: string;
  size: number;
  hoursAgo: number;
  agentId: string;
  conversationId: string | null;
  source?: StoredFileSource;
  status?: StoredFileStatus;
  image?: [string, string];
}

function row(seed: FileSeed, index: number): StoredFileRow {
  const extension = seed.name.split(".").at(-1) ?? "";
  const image = Boolean(seed.image);
  const kind: AttachmentKind = image ? "image" : "file";
  const source = seed.source ?? (image ? "generated" : "attachment");
  const previewKind: AttachmentPreviewKind = image
    ? "image"
    : extension === "pdf"
      ? "pdf"
      : ["md", "txt", "ts", "py", "json", "csv", "html"].includes(extension)
        ? "text"
        : "none";
  return {
    id: `file-${index}`,
    name: seed.name,
    size: seed.size,
    kind,
    mimeType: MIME[extension] ?? "application/octet-stream",
    previewKind,
    previewUrl: seed.image ? thumbnail(...seed.image) : null,
    source,
    agentId: seed.agentId,
    conversation: seed.conversationId ? conversation(seed.conversationId) : null,
    messageId: seed.conversationId ? `message-${index}` : null,
    createdAt: new Date(FILES_NOW.getTime() - seed.hoursAgo * 3_600_000).toISOString(),
    status: seed.status ?? "available",
    deletable: source === "attachment" || source === "generated",
  };
}

const SEEDS: FileSeed[] = [
  { name: "release-notes-v4.md", size: 18 * KB, hoursAgo: 0.5, agentId: "chief", conversationId: "c-launch" },
  {
    name: "launch-hero.png",
    size: 2.4 * MB,
    hoursAgo: 1,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#3987e5", "#9085e9"],
  },
  {
    name: "launch-hero-dark.png",
    size: 2.1 * MB,
    hoursAgo: 1.2,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#1b2a4a", "#3987e5"],
  },
  { name: "pricing-sources.pdf", size: 4.6 * MB, hoursAgo: 2, agentId: "research", conversationId: "c-sources" },
  { name: "competitor-prices.xlsx", size: 380 * KB, hoursAgo: 3, agentId: "research", conversationId: "c-sources" },
  { name: "interview-anna.m4a", size: 38 * MB, hoursAgo: 4, agentId: "research", conversationId: "c-interviews" },
  { name: "nordics-prospects.csv", size: 1.1 * MB, hoursAgo: 5, agentId: "sales", conversationId: "c-prospects" },
  {
    name: "launch-timeline.png",
    size: 860 * KB,
    hoursAgo: 6,
    agentId: "chief",
    conversationId: "c-launch",
    image: ["#199e70", "#3987e5"],
  },
  {
    name: "agent-keys.ts",
    size: 6 * KB,
    hoursAgo: 7,
    agentId: "chief",
    conversationId: "c-launch",
    source: "workspace",
  },
  {
    name: "scrape_sources.py",
    size: 12 * KB,
    hoursAgo: 8,
    agentId: "research",
    conversationId: null,
    source: "workspace",
  },
  {
    name: "campaign-banner-wide.png",
    size: 3.2 * MB,
    hoursAgo: 26,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#d95926", "#9085e9"],
  },
  {
    name: "campaign-banner-square.png",
    size: 2.7 * MB,
    hoursAgo: 26.5,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#d95926", "#f0b35a"],
  },
  { name: "follow-up-template.docx", size: 64 * KB, hoursAgo: 28, agentId: "sales", conversationId: "c-followups" },
  {
    name: "interview-jonas.m4a",
    size: 31 * MB,
    hoursAgo: 29,
    agentId: "research",
    conversationId: "c-interviews",
    status: "remote",
    source: "attachment",
  },
  { name: "evidence-map.json", size: 42 * KB, hoursAgo: 30, agentId: "research", conversationId: "c-sources" },
  {
    name: "old-pricing-deck.pdf",
    size: 7.8 * MB,
    hoursAgo: 31,
    agentId: "research",
    conversationId: "c-sources",
    status: "missing",
  },
  { name: "brand-guidelines.pdf", size: 12.4 * MB, hoursAgo: 50, agentId: "chief", conversationId: "c-brand" },
  { name: "product-demo.mov", size: 184 * MB, hoursAgo: 52, agentId: "chief", conversationId: "c-launch" },
  {
    name: "moodboard-01.jpg",
    size: 1.8 * MB,
    hoursAgo: 54,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#9085e9", "#199e70"],
  },
  {
    name: "moodboard-02.jpg",
    size: 1.6 * MB,
    hoursAgo: 54.2,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#f0b35a", "#d95926"],
  },
  {
    name: "moodboard-03.jpg",
    size: 1.9 * MB,
    hoursAgo: 54.4,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#3987e5", "#199e70"],
  },
  { name: "lead-scoring.xlsx", size: 920 * KB, hoursAgo: 56, agentId: "sales", conversationId: "c-prospects" },
  { name: "prospect-notes.txt", size: 9 * KB, hoursAgo: 58, agentId: "sales", conversationId: "c-prospects" },
  { name: "q3-board-update.pdf", size: 3.3 * MB, hoursAgo: 75, agentId: "chief", conversationId: "c-launch" },
  {
    name: "landing-page.html",
    size: 65 * KB,
    hoursAgo: 78,
    agentId: "chief",
    conversationId: "c-launch",
    source: "workspace",
  },
  {
    name: "research-archive.zip",
    size: 68 * MB,
    hoursAgo: 80,
    agentId: "research",
    conversationId: null,
    source: "download",
  },
  { name: "market-size-model.xlsx", size: 1.4 * MB, hoursAgo: 100, agentId: "research", conversationId: "c-sources" },
  { name: "survey-results.csv", size: 2.2 * MB, hoursAgo: 120, agentId: "research", conversationId: "c-sources" },
  { name: "interview-mei.m4a", size: 27 * MB, hoursAgo: 122, agentId: "research", conversationId: "c-interviews" },
  {
    name: "logo-variants.png",
    size: 740 * KB,
    hoursAgo: 150,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#e6e6e6", "#6a6a6a"],
  },
  {
    name: "sequence-step-3.md",
    size: 4 * KB,
    hoursAgo: 170,
    agentId: "sales",
    conversationId: "c-followups",
    status: "failed",
  },
  {
    name: "nordics-map.png",
    size: 1.2 * MB,
    hoursAgo: 172,
    agentId: "sales",
    conversationId: "c-prospects",
    image: ["#199e70", "#1b2a4a"],
  },
  { name: "weekly-review-template.md", size: 3 * KB, hoursAgo: 200, agentId: "chief", conversationId: "c-weekly" },
  { name: "onboarding-flow.mp4", size: 96 * MB, hoursAgo: 240, agentId: "chief", conversationId: "c-launch" },
  {
    name: "hero-illustration-v1.png",
    size: 2.9 * MB,
    hoursAgo: 260,
    agentId: "chief",
    conversationId: "c-brand",
    image: ["#9085e9", "#3987e5"],
  },
  {
    name: "contract-draft.docx",
    size: 210 * KB,
    hoursAgo: 300,
    agentId: "sales",
    conversationId: "c-prospects",
    status: "remote",
  },
  { name: "citations.md", size: 11 * KB, hoursAgo: 320, agentId: "research", conversationId: "c-sources" },
  {
    name: "export-2026-08.csv",
    size: 5.6 * MB,
    hoursAgo: 700,
    agentId: "sales",
    conversationId: null,
    source: "download",
  },
  { name: "vendor-invoice-2026-08.pdf", size: 180 * KB, hoursAgo: 720, agentId: "chief", conversationId: "c-weekly" },
  {
    name: "old-screenshot.png",
    size: 540 * KB,
    hoursAgo: 900,
    agentId: "chief",
    conversationId: "c-weekly",
    status: "missing",
    image: ["#333", "#555"],
  },
];

export const FILES_ROWS: StoredFileRow[] = SEEDS.map((seed, index) => ({
  ...row(seed, index),
  size: Math.round(seed.size),
}));

export const FILES_BREAKDOWN: StorageBreakdown[] = (
  [
    { category: "workspaces", bytes: 3.6 * GB, removable: false },
    { category: "attachments", bytes: 612 * MB, removable: false },
    { category: "generated", bytes: 148 * MB, removable: false },
    { category: "chats", bytes: 94 * MB, removable: false },
    { category: "downloads", bytes: 412 * MB, removable: false },
    { category: "caches", bytes: 286 * MB, removable: true },
    { category: "runtimes", bytes: 1.1 * GB, removable: false },
    { category: "logs", bytes: 38 * MB, removable: true },
  ] satisfies StorageBreakdown[]
).map((entry) => ({ ...entry, bytes: Math.round(entry.bytes) }));

/** A server with years of agent work, for the widths and units of a large total. */
export const FILES_BREAKDOWN_LARGE: StorageBreakdown[] = (
  [
    { category: "workspaces", bytes: 1.3 * 1024 * GB, removable: false },
    { category: "attachments", bytes: 214 * GB, removable: false },
    { category: "generated", bytes: 38 * GB, removable: false },
    { category: "chats", bytes: 6.2 * GB, removable: false },
    { category: "downloads", bytes: 71 * GB, removable: false },
    { category: "caches", bytes: 12 * GB, removable: true },
    { category: "runtimes", bytes: 2.4 * GB, removable: false },
    { category: "logs", bytes: 900 * MB, removable: true },
  ] satisfies StorageBreakdown[]
).map((entry) => ({ ...entry, bytes: Math.round(entry.bytes) }));

export const FILES_AGENT_USAGE: AgentStorageRow[] = [
  { agentId: "chief", bytes: Math.round(2.9 * GB), fileCount: 21, conversationCount: 3 },
  { agentId: "research", bytes: Math.round(1.2 * GB), fileCount: 13, conversationCount: 2 },
  { agentId: "sales", bytes: Math.round(354 * MB), fileCount: 8, conversationCount: 2 },
];

/** Chief's share of each location, for Agent settings > Files. */
export const FILES_CHIEF_BREAKDOWN: StorageBreakdown[] = [
  { category: "workspaces", bytes: Math.round(2.3 * GB), removable: false },
  { category: "attachments", bytes: 402 * MB, removable: false },
  { category: "generated", bytes: 131 * MB, removable: false },
  { category: "chats", bytes: 61 * MB, removable: false },
];

export const FILES_CHIEF_ROWS = FILES_ROWS.filter((file) => file.agentId === "chief");
export const FILES_CHIEF_CONVERSATIONS = FILES_CONVERSATIONS.filter((chat) => chat.agentId === "chief");

export const FILES_LAUNCH_ROWS = FILES_ROWS.filter((file) => file.conversation?.id === "c-launch");
export const FILES_SOURCES_ROWS = FILES_ROWS.filter((file) => file.conversation?.id === "c-sources");

/** The pricing-brief chat with one file of each status, for the missing and remote row design. */
export const FILES_STATUS_ROWS: StoredFileRow[] = [
  ...FILES_SOURCES_ROWS,
  ...FILES_ROWS.filter((file) => file.status === "remote" || file.status === "failed").map((file) => ({
    ...file,
    id: `status-${file.id}`,
    agentId: "research",
    conversation: FILES_SOURCES_ROWS[0]?.conversation ?? null,
  })),
];

export const FILES_LONG_NAME_ROWS: StoredFileRow[] = [
  {
    ...FILES_ROWS[0],
    id: "long-1",
    name: "customer-import-validation-pipeline.final.review.after-legal-comments.ts",
    mimeType: "text/typescript",
  },
  {
    ...FILES_ROWS[4],
    id: "long-2",
    name: "quarterly-operating-plan-with-regional-breakdown-and-headcount-forecast.xlsx",
  },
  {
    ...FILES_ROWS[1],
    id: "long-3",
    name: "autumn-campaign-hero-image-generated-variant-with-warmer-light-and-logo.png",
  },
];
