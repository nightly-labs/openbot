import type { DraftAttachment, InstalledSkill, McpServerConfig } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "../../data";
import { ComposerEditor } from "./ComposerEditor";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function renderComposer(
  attachments: DraftAttachment[] = [],
  initialValue = "",
  agents: AgentProfile[] = [],
  skills: InstalledSkill[] = [],
  mcpServers: McpServerConfig[] = [],
) {
  const onSubmit = vi.fn();
  const onValueChange = vi.fn();
  const onOpenAttachment = vi.fn();

  render(() => {
    const [value, setValue] = createSignal(initialValue);
    return (
      <ComposerEditor
        agentId="chief"
        agents={agents}
        skills={skills}
        mcpServers={mcpServers}
        attachments={attachments}
        value={value()}
        placeholder="Message Chief"
        ariaLabel="Message Chief"
        disabled={false}
        onValueChange={(nextValue) => {
          onValueChange(nextValue);
          setValue(nextValue);
        }}
        onSubmit={onSubmit}
        onOpenAttachment={onOpenAttachment}
      />
    );
  });

  return {
    editor: screen.getByRole("textbox", { name: "Message Chief" }),
    onSubmit,
    onValueChange,
    onOpenAttachment,
  };
}

function mcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "mcp-aave",
    name: "Aave",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.aave.com/mcp",
    headers: [],
    ...overrides,
  };
}

/** Types a trigger and its query, the way the picker reads the caret. */
async function typeQuery(editor: HTMLElement, text: string) {
  editor.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  await fireEvent.input(editor);
}

describe("ComposerEditor", () => {
  it("does not submit when Enter confirms IME composition", async () => {
    const { editor, onSubmit } = renderComposer();

    await fireEvent.compositionStart(editor);
    await fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.compositionEnd(editor);
    await fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("tags an MCP server from the same trigger the skills answer", async () => {
    const { editor, onValueChange } = renderComposer([], "", [], [], [mcpServer()]);

    await typeQuery(editor, "$Aa");
    const picker = await screen.findByRole("listbox", { name: "Insert skill or MCP server" });
    expect(picker).toHaveTextContent("Aave");
    await fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("@[Aave](mcp:mcp-aave) "));
    expect(screen.getByLabelText("MCP server Aave")).toBeInTheDocument();
  });

  it("withholds a server the host has turned off", async () => {
    const { editor } = renderComposer([], "", [], [], [mcpServer({ enabled: false })]);

    await typeQuery(editor, "$Aa");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("draws a tagged server the host no longer holds as unavailable", async () => {
    renderComposer([], "@[Aave](mcp:mcp-aave) is down?", [], [], []);

    expect(screen.getByLabelText("Unavailable MCP server Aave")).toBeInTheDocument();
  });
});
