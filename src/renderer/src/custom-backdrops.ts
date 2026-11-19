import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { customBackdropId } from "@openbot/ui/features/conversation/chat-backdrop";
import { createSignal } from "solid-js";
import { useChatBackdrop } from "./chat-backdrop-preference";

export type CustomBackdropKind = "image" | "page";

export interface CustomBackdropSummary {
  id: string;
  name: string;
  kind: CustomBackdropKind;
  createdAt: number;
}

export interface CustomBackdrop extends CustomBackdropSummary {
  mimeType: string;
  blob: Blob;
}

export const CUSTOM_BACKDROP_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;
const IMAGE_MIME_TYPES = new Set<string>(CUSTOM_BACKDROP_IMAGE_TYPES);
const CUSTOM_BACKDROP_IMAGE_LIMIT = 20 * 1_024 * 1_024;
const CUSTOM_BACKDROP_CAPACITY = 12;
const NAME_LIMIT = 80;

const DATABASE = "openbot-backdrops";
const STORE = "backdrops";
const CHANGED_CHANNEL = "openbot:custom-backdrops";

export function customBackdropKind(mimeType: string, size: number): CustomBackdropKind | null {
  const type = (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
  if (IMAGE_MIME_TYPES.has(type)) return size <= CUSTOM_BACKDROP_IMAGE_LIMIT ? "image" : null;
  if (isChatVisualMimeType(type) && type !== "image/svg+xml") return size <= CHAT_VISUAL_PAGE_LIMIT ? "page" : null;
  return null;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = window.indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(STORE, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  database.catch(() => {
    database = undefined;
  });
  return database;
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await openDatabase()).transaction(STORE, mode).objectStore(STORE);
}

function isCustomBackdrop(value: unknown): value is CustomBackdrop {
  if (!isDynamicRecord(value)) return false;
  const record = value;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    (record.kind === "image" || record.kind === "page") &&
    typeof record.mimeType === "string" &&
    record.blob instanceof Blob &&
    typeof record.createdAt === "number"
  );
}

const [summaries, setSummaries] = createSignal<CustomBackdropSummary[]>([], {
  equals: (a, b) =>
    a.length === b.length &&
    a.every(
      (item, index) =>
        item.id === b[index]?.id &&
        item.name === b[index]?.name &&
        item.kind === b[index]?.kind &&
        item.createdAt === b[index]?.createdAt,
    ),
});

async function readAll(): Promise<CustomBackdrop[]> {
  const values: unknown[] = await request((await store("readonly")).getAll());
  return values.filter(isCustomBackdrop).sort((a, b) => a.createdAt - b.createdAt);
}

async function refresh(): Promise<void> {
  try {
    const all = await readAll();
    setSummaries(all.map(({ id, name, kind, createdAt }) => ({ id, name, kind, createdAt })));
  } catch {}
}

let channel: BroadcastChannel | undefined;

function announce(): void {
  channel?.postMessage("changed");
}

if (typeof window !== "undefined" && "indexedDB" in window) {
  void refresh();
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANGED_CHANNEL);
    channel.onmessage = () => void refresh();
    import.meta.hot?.dispose(() => channel?.close());
  }
}

export function useCustomBackdrops(): () => CustomBackdropSummary[] {
  return summaries;
}

export async function readCustomBackdrop(id: string): Promise<CustomBackdrop | null> {
  const record = await request<unknown>((await store("readonly")).get(id));
  return isCustomBackdrop(record) ? record : null;
}

export async function addCustomBackdrop(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  id?: string;
}): Promise<string> {
  const kind = customBackdropKind(input.mimeType, input.bytes.byteLength);
  if (kind === null) throw new Error("This file cannot be a backdrop.");
  const backdrop: CustomBackdrop = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim().slice(0, NAME_LIMIT) || input.mimeType,
    kind,
    mimeType: input.mimeType,
    blob: new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
    createdAt: Date.now(),
  };
  const current = useChatBackdrop()();
  const shownId = current === null ? null : customBackdropId(current);
  const others = (await readAll()).filter(({ id }) => id !== backdrop.id);
  const overflow = Math.max(0, others.length + 1 - CUSTOM_BACKDROP_CAPACITY);
  const oldest = others.filter(({ id }) => id !== shownId).slice(0, overflow);
  const writable = await store("readwrite");
  for (const old of oldest) writable.delete(old.id);
  await request(writable.put(backdrop));
  await refresh();
  announce();
  return backdrop.id;
}

export async function removeCustomBackdrop(id: string): Promise<void> {
  await request((await store("readwrite")).delete(id));
  await refresh();
  announce();
}
