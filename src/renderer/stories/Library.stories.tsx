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
import { FILES_AGENTS, FILES_NOW, FILES_ROWS, FILES_WORKFLOW_ROWS } from "./files-fixtures";
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

const STORY_FILE_MS = 260;

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, STORY_FILE_MS));

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

export const Ready: Story = { render: () => <LibraryStage args={libraryArgs()} /> };

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

const FOLDER_OF_CHAT: Record<string, string> = {
  "c-brand": "folder-campaign",
  "c-launch": "folder-launch",
  "c-interviews": "folder-interviews",
  "c-sources": "folder-pricing",
};

const IMAGES_OF_FOLDER: Record<string, string> = { "folder-campaign": "folder-campaign-images" };

const DAY_MS = 86_400_000;

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
const FILE_AGENTS = new Map(
  [...TEAM_FILES, ...FILES_WORKFLOW_ROWS].flatMap((file) =>
    file.agentId === null && file.workflow === undefined ? [] : [[file.id, file.agentId] as const],
  ),
);

const FAVORITES = ["folder-launch", "agent:research"];

function FolderStage(props: { initialLocation?: LibraryLocation; files?: readonly StoredFileRow[] }) {
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
        files: props.files ?? TEAM_FILES,
        agents: TEAM_AGENTS,
        folders: folders(),
        onFolderAction: change,
        initialLocation: props.initialLocation,
        initialFavorites: FAVORITES,
      }}
    />
  );
}

export const Folders: Story = { render: () => <FolderStage /> };

export const FoldersAgent: Story = {
  name: "Folders: an agent",
  render: () => <FolderStage initialLocation={{ kind: "agent", agentId: "chief" }} />,
};

export const FoldersFolder: Story = {
  name: "Folders: a folder",
  render: () => <FolderStage initialLocation={{ kind: "folder", agentId: "chief", folderId: "folder-campaign" }} />,
};

export const FoldersWorkflows: Story = {
  name: "Folders: workflows",
  render: () => <FolderStage files={[...TEAM_FILES, ...FILES_WORKFLOW_ROWS]} />,
};

export const FoldersWorkflow: Story = {
  name: "Folders: a workflow",
  render: () => (
    <FolderStage
      files={[...TEAM_FILES, ...FILES_WORKFLOW_ROWS]}
      initialLocation={{ kind: "workflow", workflowId: "workflow-weekly-posts" }}
    />
  ),
};

export const LoadError: Story = {
  name: "Error",
  render: () => (
    <LibraryStage args={{ ...libraryArgs(), files: [], error: "The server did not answer.", onRetry: fn() }} />
  ),
};
