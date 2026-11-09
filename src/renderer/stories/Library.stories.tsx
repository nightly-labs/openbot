import { LibraryPage } from "@openbot/ui/features/files/LibraryPage";
import type { ComponentProps } from "@solidjs/web";
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

function LibraryStage(props: { args: LibraryArgs }) {
  return (
    <main class="library-story-stage">
      <LibraryPage {...props.args} />
    </main>
  );
}

/** Every picture and file of the server's chats, newest first. */
export const Ready: Story = { render: () => <LibraryStage args={libraryArgs()} /> };

/** A member of a remote server can open and download files, but not delete them. */
export const Member: Story = { render: () => <LibraryStage args={{ ...libraryArgs(), canDelete: false }} /> };

export const Loading: Story = { render: () => <LibraryStage args={{ ...libraryArgs(), files: [], loading: true }} /> };

export const Empty: Story = { render: () => <LibraryStage args={{ ...libraryArgs(), files: [] }} /> };

export const LoadError: Story = {
  name: "Error",
  render: () => (
    <LibraryStage args={{ ...libraryArgs(), files: [], error: "The server did not answer.", onRetry: fn() }} />
  ),
};
