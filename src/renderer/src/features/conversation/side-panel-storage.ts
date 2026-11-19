import { isAttachmentSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createEffect, type Store } from "solid-js";
import { readRestoreLastWorkspace } from "../../restore-workspace-preference";
import type { RightPanelMode } from "./conversation-types";
import { filePreviewKey, type SidePanelFile, type SidePanelState, type SidePanelsState } from "./stores/panels-store";

const SIDE_PANEL_FILES_STORAGE_KEY = "openbot:side-panel-files";
const LOCAL_ATTACHMENT_URL = /^openbot-attachment:/u;

interface StoredSidePanels {
  shown: boolean;
  side: Record<string, SidePanelState>;
}

export function readStoredSidePanels(): StoredSidePanels {
  if (!readRestoreLastWorkspace()) return { shown: false, side: {} };
  try {
    return decodeStoredSidePanels(JSON.parse(window.localStorage.getItem(SIDE_PANEL_FILES_STORAGE_KEY) ?? "null"));
  } catch {
    return { shown: false, side: {} };
  }
}

export function writeSidePanelsOnChange(
  panels: Store<SidePanelsState>,
  rightPanels: () => Record<string, RightPanelMode>,
): void {
  createEffect(
    () => storableSidePanels(panels.side, rightPanels()),
    (value) => {
      try {
        window.localStorage.setItem(SIDE_PANEL_FILES_STORAGE_KEY, value);
      } catch {}
    },
    { defer: true },
  );
}

function storableSidePanels(side: Record<string, SidePanelState>, rightPanels: Record<string, RightPanelMode>): string {
  const owners = Object.fromEntries(
    Object.entries(side).flatMap(([ownerId, state]) => {
      const files = state.files.flatMap((file) =>
        isStorableSource(file.source) ? [{ name: file.name, source: file.source }] : [],
      );
      if (files.length === 0) return [];
      const file = files.some((item) => filePreviewKey(item.source) === state.file) ? state.file : null;
      return [[ownerId, { files, file }]];
    }),
  );
  const shownOwner =
    Object.keys(owners).find((ownerId) => rightPanels[ownerId] === "file-preview" && owners[ownerId]?.file) ?? null;
  return JSON.stringify({ shownOwner, owners });
}

function isStorableSource(source: SidePanelFile["source"]): boolean {
  if (source.kind !== "attachment") return true;
  const url = source.attachment.previewUrl;
  return url === null || LOCAL_ATTACHMENT_URL.test(url);
}

function decodeStoredSidePanels(value: unknown): StoredSidePanels {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.owners)) return { shown: false, side: {} };
  const side = Object.fromEntries(
    Object.entries(value.owners).flatMap(([ownerId, owner]) => {
      const state = decodeOwner(owner);
      return state ? [[ownerId, state]] : [];
    }),
  );
  const shown = isString(value.shownOwner) && Boolean(side[value.shownOwner]?.file);
  return { shown, side };
}

function decodeOwner(value: unknown): SidePanelState | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.files)) return null;
  const files = value.files.flatMap((item: unknown): SidePanelFile[] => {
    if (!isDynamicRecord(item) || !isString(item.name)) return [];
    const source = decodeSource(item.source);
    if (!source || !isStorableSource(source)) return [];
    const key = filePreviewKey(source);
    return [{ key, name: item.name, folder: source.kind === "workspace-folder", source, unavailable: false }];
  });
  if (files.length === 0) return null;
  const file = isString(value.file) && files.some((item) => item.key === value.file) ? value.file : null;
  return { panes: [], selected: null, files, file, maximized: false };
}

function decodeSource(value: unknown): SidePanelFile["source"] | null {
  if (!isDynamicRecord(value)) return null;
  if (value.kind === "attachment")
    return isAttachmentSummary(value.attachment) ? { kind: "attachment", attachment: value.attachment } : null;
  if (!isString(value.path)) return null;
  if (value.kind === "shared") return { kind: "shared", path: value.path };
  if (!isString(value.agentId)) return null;
  if (value.kind === "workspace-folder") return { kind: "workspace-folder", agentId: value.agentId, path: value.path };
  if (value.kind !== "workspace") return null;
  return {
    kind: "workspace",
    agentId: value.agentId,
    path: value.path,
    folder: isString(value.folder) ? value.folder : undefined,
  };
}
