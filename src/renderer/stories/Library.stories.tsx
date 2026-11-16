import {
  applyLibraryFolderAction,
  type LibraryFolder,
  type LibraryFolderAction,
  type LibraryFoldersSnapshot,
} from "@openbot/contracts/ipc";
import { Toaster } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import type { StoredFileRow } from "@openbot/ui/features/files/files-view";
import { type BatchFileAction, type LibraryLocation, LibraryPage } from "@openbot/ui/features/files/LibraryPage";
import type { ComponentProps } from "@solidjs/web";
import { createSignal, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FILES_AGENTS, FILES_NOW, FILES_ROWS } from "./files-fixtures";
import { MANY_AGENTS } from "./marketplace-story-support";

const meta = {
  title: "Files/Library",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type LibraryArgs = ComponentProps<typeof LibraryPage>;

const libraryArgs = (): LibraryArgs => ({
  files: FILES_ROWS,
  agents: FILES_AGENTS,
  now: FILES_NOW,
  canDelete: true,
  onOpen: fn(),
  onAction: fn(async () => undefined),
});

/** How long one file takes in the story's download and delete. */
const STORY_FILE_MS = 260;

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, STORY_FILE_MS));

/** One file at a time, as the desktop app does, so the pill shows its progress. */
function storyBatch(after?: (files: readonly StoredFileRow[]) => void): BatchFileAction {
  return async (files, onProgress) => {
    for (const [index] of files.entries()) {
      await wait();
      onProgress(index + 1);
    }
    after?.(files);
    return 0;
  };
}

/** The Library with files that a delete removes, so the selection pill can be tried from start to end. */
function LibraryStage(props: { args: LibraryArgs }) {
  const [files, setFiles] = createSignal<readonly StoredFileRow[]>(untrack(() => props.args.files));
  const remove = (gone: readonly StoredFileRow[]) => {
    const ids = new Set(gone.map((file) => file.id));
    setFiles((current) => current.filter((file) => !ids.has(file.id)));
  };
  return (
    <main class="library-story-stage">
      <LibraryPage {...props.args} files={files()} onSaveFiles={storyBatch()} onDeleteFiles={storyBatch(remove)} />
      <Toaster />
    </main>
  );
}

/**
 * Every picture and file of the server's chats, newest first. Select, a Command-click or a drag over
 * the files selects them; the pill at the bottom downloads or deletes them.
 */
export const Ready: Story = { render: () => <LibraryStage args={libraryArgs()} /> };

/** A member of a remote server can open, select and download files, but not delete them. */
export const Member: Story = { render: () => <LibraryStage args={{ ...libraryArgs(), canDelete: false }} /> };

export const Loading: Story = { render: () => <LibraryStage args={{ ...libraryArgs(), files: [], loading: true }} /> };

export const Empty: Story = { render: () => <LibraryStage args={{ ...libraryArgs(), files: [] }} /> };

const FOLDERS: LibraryFolder[] = [
  { id: "folder-campaign", agentId: "chief", name: "Autumn campaign" },
  { id: "folder-campaign-images", agentId: "chief", name: "Images", parentId: "folder-campaign" },
  { id: "folder-launch", agentId: "chief", name: "Launch" },
  { id: "folder-interviews", agentId: "research", name: "Interviews" },
  { id: "folder-pricing", agentId: "research", name: "Pricing brief" },
];

/** The folder that holds the older files of a chat. */
const FOLDER_OF_CHAT: Record<string, string> = {
  "c-brand": "folder-campaign",
  "c-launch": "folder-launch",
  "c-interviews": "folder-interviews",
  "c-sources": "folder-pricing",
};

/** The folder in a folder: it holds the pictures of that folder. */
const IMAGES_OF_FOLDER: Record<string, string> = { "folder-campaign": "folder-campaign-images" };

const DAY_MS = 86_400_000;

/** The files of the last day are in no folder yet, as new output of an agent is. */
const FOLDERS_SNAPSHOT: LibraryFoldersSnapshot = {
  revision: 1,
  folders: FOLDERS,
  placement: Object.fromEntries(
    FILES_ROWS.flatMap((file) => {
      const folder = file.conversation ? FOLDER_OF_CHAT[file.conversation.id] : undefined;
      const recent = FILES_NOW.getTime() - new Date(file.createdAt).getTime() < DAY_MS;
      if (!folder || recent) return [];
      const images = file.mimeType.startsWith("image/") ? IMAGES_OF_FOLDER[folder] : undefined;
      return [[file.id, images ?? folder]];
    }),
  ),
};

/** The story agents, then the agents of the many-agents fixture: a server with a large team. */
const TEAM_AGENTS: readonly AgentProfile[] = (() => {
  const known = new Set(FILES_AGENTS.map((agent) => agent.id));
  const base = FILES_AGENTS[0];
  if (!base) return FILES_AGENTS;
  const more = MANY_AGENTS.filter((summary) => !known.has(summary.id)).map(
    (summary): AgentProfile => ({
      ...base,
      id: summary.id,
      name: summary.name,
      title: summary.title,
      avatarSeed: summary.avatarSeed,
      avatarHue: summary.avatarHue,
    }),
  );
  return [...FILES_AGENTS, ...more];
})();

/**
 * The story files, and two older files for each of 17 more agents: a large team where many agents
 * made files, so the side panel shows only the agents with the newest files.
 */
const TEAM_FILES: readonly StoredFileRow[] = [
  ...FILES_ROWS,
  ...TEAM_AGENTS.slice(FILES_AGENTS.length, FILES_AGENTS.length + 17).flatMap((agent, index) =>
    [0, 1].flatMap((offset) => {
      const source = FILES_ROWS[(index * 2 + offset) % FILES_ROWS.length];
      if (!source) return [];
      const createdAt = new Date(FILES_NOW.getTime() - (index + 2 + offset) * DAY_MS).toISOString();
      return [{ ...source, id: `${source.id}-${agent.id}`, agentId: agent.id, conversation: null, createdAt }];
    }),
  ),
];

const FOLDER_AGENTS = new Set(TEAM_AGENTS.map((agent) => agent.id));
const FILE_AGENTS = new Map(TEAM_FILES.map((file) => [file.id, file.agentId] as const));

/** A folder and an agent that the viewer starred. */
const FAVORITES = ["folder-launch", "agent:research"];

/** The Library of a host that has folders. The story keeps the folders, as the host does. */
function FolderStage(props: { initialLocation?: LibraryLocation }) {
  const [folders, setFolders] = createSignal(FOLDERS_SNAPSHOT);
  const change = (action: LibraryFolderAction) =>
    setFolders((current) =>
      applyLibraryFolderAction(current, action, {
        agentIds: FOLDER_AGENTS,
        fileAgent: (fileId) => FILE_AGENTS.get(fileId),
      }),
    );
  return (
    <LibraryStage
      args={{
        ...libraryArgs(),
        files: TEAM_FILES,
        agents: TEAM_AGENTS,
        folders: folders(),
        onFolderAction: change,
        initialLocation: props.initialLocation,
        initialFavorites: FAVORITES,
      }}
    />
  );
}

/**
 * A host with folders and a large team. The side panel has the views (all files, recent, not in a
 * folder), the favorites, and the agents with the newest files; the list of all agents finds the others. The
 * folders of the place show as tiles above the files. A drag moves files and folders into a folder of
 * the panel, a tile or the path; a drag that stays on a folder opens it, and the "New folder" tile takes
 * the dragged files into a new folder. The menu of a folder stars it, makes a folder in it, renames it
 * or deletes it, and a delete has an Undo.
 */
export const Folders: Story = { render: () => <FolderStage /> };

/** All the files of one agent, also the files that are in a folder. */
export const FoldersAgent: Story = {
  name: "Folders: an agent",
  render: () => <FolderStage initialLocation={{ kind: "agent", agentId: "chief" }} />,
};

/** The files of one folder and of the folders in it. */
export const FoldersFolder: Story = {
  name: "Folders: a folder",
  render: () => <FolderStage initialLocation={{ kind: "folder", agentId: "chief", folderId: "folder-campaign" }} />,
};

export const LoadError: Story = {
  name: "Error",
  render: () => (
    <LibraryStage args={{ ...libraryArgs(), files: [], error: "The server did not answer.", onRetry: fn() }} />
  ),
};
