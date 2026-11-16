import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createSignal } from "solid-js";

/**
 * The backdrops that the user added on this device and browser: a picture or GIF, or an HTML page
 * that an agent made. They stay in this browser's IndexedDB. Nothing goes to a joined server: the
 * backdrop changes only this screen. Each window of the app reads the same store, and a change in one
 * window reaches the others through a broadcast channel.
 */

export type CustomBackdropKind = "image" | "page";

export interface CustomBackdropSummary {
  id: string;
  name: string;
  kind: CustomBackdropKind;
  /** When the bytes were saved. An agent replaces its backdrop in place, so this tells a new page. */
  createdAt: number;
}

export interface CustomBackdrop extends CustomBackdropSummary {
  mimeType: string;
  bytes: Uint8Array;
}

/** The pictures that a browser shows and animates. SVG stays out: a page can be made for that. */
export const CUSTOM_BACKDROP_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;
const IMAGE_MIME_TYPES = new Set<string>(CUSTOM_BACKDROP_IMAGE_TYPES);
/** A larger picture fills the disk and slows each window start. */
export const CUSTOM_BACKDROP_IMAGE_LIMIT = 20 * 1_024 * 1_024;
/** The most backdrops on one device. Adding one more removes the oldest. */
const CUSTOM_BACKDROP_CAPACITY = 12;
const NAME_LIMIT = 80;

const DATABASE = "openbot-backdrops";
const STORE = "backdrops";
const CHANGED_CHANNEL = "openbot:custom-backdrops";

/** The kind of backdrop that a file can be, or null when it cannot be one. */
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
  // A blocked or failed open is tried again on the next call.
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
    record.bytes instanceof Uint8Array &&
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
  } catch {
    // Blocked storage keeps the list empty: only the built-in scenes show.
  }
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

/** The backdrops on this device, oldest first. The list changes when any window adds or removes one. */
export function useCustomBackdrops(): () => CustomBackdropSummary[] {
  return summaries;
}

export async function readCustomBackdrop(id: string): Promise<CustomBackdrop | null> {
  const record = await request<unknown>((await store("readonly")).get(id));
  return isCustomBackdrop(record) ? record : null;
}

/**
 * Keeps a file as a backdrop and answers its id. The caller checks the kind with
 * `customBackdropKind` first. When the device holds the most backdrops, the oldest goes.
 */
export async function addCustomBackdrop(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  /** The id of a backdrop that this one replaces in place, such as the one slot of an agent. */
  id?: string;
}): Promise<string> {
  const kind = customBackdropKind(input.mimeType, input.bytes.byteLength);
  if (kind === null) throw new Error("This file cannot be a backdrop.");
  const backdrop: CustomBackdrop = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim().slice(0, NAME_LIMIT) || input.mimeType,
    kind,
    mimeType: input.mimeType,
    bytes: input.bytes,
    createdAt: Date.now(),
  };
  const saved = (await readAll()).filter(({ id }) => id !== backdrop.id);
  const oldest = saved.slice(0, Math.max(0, saved.length + 1 - CUSTOM_BACKDROP_CAPACITY));
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
