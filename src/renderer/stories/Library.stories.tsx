import { Toaster } from "@openbot/ui";
import type { StoredFileRow } from "@openbot/ui/features/files/files-view";
import { type BatchFileAction, LibraryPage } from "@openbot/ui/features/files/LibraryPage";
import type { ComponentProps } from "@solidjs/web";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FILES_AGENTS, FILES_NOW, FILES_ROWS } from "./files-fixtures";

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
  const [files, setFiles] = createSignal<readonly StoredFileRow[]>(props.args.files);
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

export const LoadError: Story = {
  name: "Error",
  render: () => (
    <LibraryStage args={{ ...libraryArgs(), files: [], error: "The server did not answer.", onRetry: fn() }} />
  ),
};
