import { ContextMenu } from "@openbot/ui";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import {
  MarkdownMessageText,
  mentionedFolderTarget,
  messageImageFiles,
} from "@openbot/ui/features/conversation/MarkdownMessageText";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

function selectMenuItem(item: HTMLElement) {
  fireEvent.pointerDown(item);
  fireEvent.pointerUp(item);
  fireEvent.click(item);
}

describe("mentionedFolderTarget", () => {
  it("recognizes local Windows, tilde, Unix, shared, and relative folder paths", () => {
    expect(mentionedFolderTarget("E:\\workspaces\\openbot\\packages\\ui\\")).toEqual({
      path: "E:\\workspaces\\openbot\\packages\\ui\\",
      kind: "workspace",
      folder: true,
    });
    expect(mentionedFolderTarget("E:\\workspaces\\openbot")).toEqual({
      path: "E:\\workspaces\\openbot",
      kind: "workspace",
      folder: true,
    });
    expect(mentionedFolderTarget("C:\\Program Files\\OpenBot\\")).toEqual({
      path: "C:\\Program Files\\OpenBot\\",
      kind: "workspace",
      folder: true,
    });
    expect(mentionedFolderTarget("~/projects/openbot/")).toEqual({
      path: "~/projects/openbot/",
      kind: "workspace",
      folder: true,
    });
    expect(mentionedFolderTarget("/Users/alice/projects/openbot/")).toEqual({
      path: "/Users/alice/projects/openbot/",
      kind: "workspace",
      folder: true,
    });
    expect(mentionedFolderTarget("~/OpenBot/Shared/reports/")).toEqual({
      path: "~/OpenBot/Shared/reports/",
      kind: "shared",
      folder: true,
    });
    expect(mentionedFolderTarget("C:\\Users\\js\\OpenBot\\Shared\\reports\\")).toEqual({
      path: "C:\\Users\\js\\OpenBot\\Shared\\reports\\",
      kind: "shared",
      folder: true,
    });
    expect(mentionedFolderTarget("packages/ui/")).toEqual({
      path: "packages/ui/",
      kind: "workspace",
      folder: true,
    });
    expect(mentionedFolderTarget("./docs/")).toEqual({
      path: "./docs/",
      kind: "workspace",
      folder: true,
    });
  });

  it("rejects commands, flags, URLs, API routes, and placeholder example paths", () => {
    const falsePositives = [
      "E:\\workspaces\\...\\folder\\",
      "E:\\workspaces\\\u2026\\folder\\",
      "/path/to/folder/",
      "C:\\path\\to\\folder\\",
      "~/path/to/dir/",
      "C:\\Users\\<user>\\project\\",
      "/Users/{username}/code/",
      "packages/[slug]/",
      "src/*/components/",
      "cd E:\\workspaces\\openbot",
      "E:\\workspaces\\openbot\\app --help",
      "C:\\tools\\run -v",
      "rm -rf /tmp/foo/",
      "C:\\dir && npm test",
      "E:\\workspaces\\openbot is the repo folder",
      "https://github.com/nightly-labs/openbot/",
      "/api/v1/users/",
      "/settings/profile/",
      "feat/chat-folder-links-context-menu",
      "v1/",
      "a/",
      "C:\\",
      "/",
      "~/",
      "./",
      "../",
      "a/b/../c/",
      "//server/share/",
      "\\\\server\\share\\",
      "C:\\Windows\\System32\\cmd.exe",
      "~/OpenBot/Shared/",
    ];
    for (const candidate of falsePositives) {
      expect(mentionedFolderTarget(candidate), candidate).toBeNull();
    }
  });

  it("does not treat image-named folders as inline image previews", () => {
    expect(messageImageFiles(["See `E:\\workspaces\\images.png\\` and `chart.png`"])).toEqual([
      { path: "E:\\workspaces\\images.png\\chart.png", kind: "workspace" },
    ]);
  });
});

describe("LocalFileLink rendering and context menu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders backtick folder paths as clickable chips and leaves example paths as plain code", () => {
    const onOpenWorkspaceFile = vi.fn();
    const onOpenSharedFile = vi.fn();
    const body =
      "Check `E:\\workspaces\\openbot\\packages\\ui\\`, `~/OpenBot/Shared/reports/`, and `E:\\workspaces\\...\\folder\\`.";
    render(() => (
      <MarkdownMessageText
        body={body}
        agents={[]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        onOpenSharedFile={onOpenSharedFile}
      />
    ));

    const workspaceChip = screen.getByRole("button", { name: "Open workspace folder ui" });
    const sharedChip = screen.getByRole("button", { name: "Open shared folder reports" });
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("E:\\workspaces\\...\\folder\\").tagName).toBe("CODE");

    fireEvent.click(workspaceChip);
    expect(onOpenWorkspaceFile).toHaveBeenCalledWith("E:\\workspaces\\openbot\\packages\\ui\\", undefined);

    fireEvent.click(sharedChip);
    expect(onOpenSharedFile).toHaveBeenCalledWith("~/OpenBot/Shared/reports/", undefined);
  });

  it("opens the file context menu instead of the message menu on right-click and dispatches reveal, open, and copy path", async () => {
    const onLocalFileAction = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const body = "Edited `src/app.ts` inside `E:\\workspaces\\openbot\\`.";

    render(() => (
      <ChatMessageRow
        message={{
          id: "msg-1",
          author: "agent",
          body,
          time: "12:00",
          kind: "text",
        }}
        author={{ kind: "agent", name: "Worker" }}
        agents={[]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onPreview={vi.fn()}
        onAttachmentAction={vi.fn()}
        onOpenSharedFile={vi.fn()}
        onOpenWorkspaceFile={vi.fn()}
        onLocalFileAction={onLocalFileAction}
        canRevealFolders={true}
        fileManagerPlatform="win32"
        menu={() => (
          <ContextMenu.Content aria-label="Message menu">
            <ContextMenu.Item onSelect={vi.fn()}>Message only action</ContextMenu.Item>
          </ContextMenu.Content>
        )}
      />
    ));

    const fileChip = screen.getByRole("button", { name: "Open workspace file app.ts" });
    fireEvent.contextMenu(fileChip);

    const revealItem = await screen.findByRole("menuitem", { name: "Show in File Explorer" });
    expect(screen.getByRole("menuitem", { name: "Open in default app" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Message only action" })).toBeNull();

    selectMenuItem(revealItem);
    expect(onLocalFileAction).toHaveBeenCalledWith(
      {
        path: "E:\\workspaces\\openbot\\src/app.ts",
        kind: "workspace",
        folder: false,
        asWritten: "src/app.ts",
      },
      "reveal",
    );

    fireEvent.contextMenu(fileChip);
    selectMenuItem(await screen.findByRole("menuitem", { name: "Open in default app" }));
    expect(onLocalFileAction).toHaveBeenCalledWith(
      {
        path: "E:\\workspaces\\openbot\\src/app.ts",
        kind: "workspace",
        folder: false,
        asWritten: "src/app.ts",
      },
      "open",
    );

    fireEvent.contextMenu(fileChip);
    selectMenuItem(await screen.findByRole("menuitem", { name: "Copy path" }));
    expect(writeText).toHaveBeenCalledWith("E:\\workspaces\\openbot\\src/app.ts");

    // Right-clicking outside the file chip still opens the message menu.
    fireEvent.contextMenu(screen.getByRole("article"));
    expect(await screen.findByRole("menuitem", { name: "Message only action" })).toBeTruthy();
  });

  it("shows Finder reveal and hides Open in default app on folder chips, and respects canRevealFolders=false", async () => {
    const onLocalFileAction = vi.fn();
    const { unmount } = render(() => (
      <MarkdownMessageText
        body="Folder: `~/projects/openbot/`"
        agents={[]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onOpenWorkspaceFile={vi.fn()}
        onLocalFileAction={onLocalFileAction}
        canRevealFolders={true}
        fileManagerPlatform="darwin"
      />
    ));

    const folderChip = screen.getByRole("button", { name: "Open workspace folder openbot" });
    fireEvent.contextMenu(folderChip);

    const finderItem = await screen.findByRole("menuitem", { name: "Show in Finder" });
    expect(screen.queryByRole("menuitem", { name: "Open in default app" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();

    selectMenuItem(finderItem);
    expect(onLocalFileAction).toHaveBeenCalledWith(
      { path: "~/projects/openbot/", kind: "workspace", folder: true, asWritten: undefined },
      "reveal",
    );

    unmount();

    render(() => (
      <MarkdownMessageText
        body="Remote folder: `~/projects/openbot/`"
        agents={[]}
        onSelectAgent={vi.fn()}
        onOpenLink={vi.fn()}
        onOpenWorkspaceFile={vi.fn()}
        onLocalFileAction={onLocalFileAction}
        canRevealFolders={false}
        fileManagerPlatform="win32"
      />
    ));

    fireEvent.contextMenu(screen.getByRole("button", { name: "Open workspace folder openbot" }));
    expect(await screen.findByRole("menuitem", { name: "Copy path" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Show in File Explorer" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open in default app" })).toBeNull();
  });
});
