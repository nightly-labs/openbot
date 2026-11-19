import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createEffect, type Store } from "solid-js";
import { readRestoreLastWorkspace } from "../../restore-workspace-preference";
import { filePreviewKey, type SidePanelFile, type SidePanelState } from "./stores/panels-store";

const SIDE_PANEL_FILES_STORAGE_KEY = "openbot:side-panel-files";

type StoredFileSource = Exclude<SidePanelFile["source"], { kind: "attachment" }>;

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

export function writeSidePanelsOnChange(side: Store<Record<string, SidePanelState>>, shown: () => boolean): void {
  createEffect(
    () => storableSidePanels(side, shown()),
    (value) => {
      try {
        window.localStorage.setItem(SIDE_PANEL_FILES_STORAGE_KEY, value);
      } catch {}
    },
    { defer: true },
  );
}

function storableSidePanels(side: Record<string, SidePanelState>, shown: boolean): string {
  const owners = Object.fromEntries(
    Object.entries(side).flatMap(([ownerId, state]) => {
      const files = state.files.flatMap((file) =>
        file.source.kind === "attachment" ? [] : [{ name: file.name, source: file.source }],
      );
      if (files.length === 0) return [];
      const file = files.some((item) => filePreviewKey(item.source) === state.file) ? state.file : null;
      return [[ownerId, { files, file }]];
    }),
  );
  return JSON.stringify({ shown: shown && Object.keys(owners).length > 0, owners });
}

function decodeStoredSidePanels(value: unknown): StoredSidePanels {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.owners)) return { shown: false, side: {} };
  const side = Object.fromEntries(
    Object.entries(value.owners).flatMap(([ownerId, owner]) => {
      const state = decodeOwner(owner);
      return state ? [[ownerId, state]] : [];
    }),
  );
  return { shown: isBoolean(value.shown) && value.shown && Object.keys(side).length > 0, side };
}

function decodeOwner(value: unknown): SidePanelState | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.files)) return null;
  const files = value.files.flatMap((item: unknown): SidePanelFile[] => {
    if (!isDynamicRecord(item) || !isString(item.name)) return [];
    const source = decodeSource(item.source);
    if (!source) return [];
    const key = filePreviewKey(source);
    return [{ key, name: item.name, folder: source.kind === "workspace-folder", source, unavailable: false }];
  });
  if (files.length === 0) return null;
  const file = isString(value.file) && files.some((item) => item.key === value.file) ? value.file : null;
  return { panes: [], selected: null, files, file, maximized: false };
}

function decodeSource(value: unknown): StoredFileSource | null {
  if (!isDynamicRecord(value) || !isString(value.path)) return null;
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
