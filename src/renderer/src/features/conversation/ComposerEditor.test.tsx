import type { DraftAttachment, InstalledSkill, McpServerConfig } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  sendShortcut: "enter" | "meta-enter" | "ctrl-enter" = "enter",
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
        sendShortcut={sendShortcut}
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
  it("does not insert text or submit after the editor becomes disabled", async () => {
    const onValueChange = vi.fn();
    const onSubmit = vi.fn();
    let disable = () => {};
    render(() => {
      const [disabled, setDisabled] = createSignal(false);
      disable = () => setDisabled(true);
      return (
        <ComposerEditor
          agentId="chief"
          agents={[]}
          value=""
          placeholder="Connect to your host to start"
          ariaLabel="Message"
          disabled={disabled()}
          onValueChange={onValueChange}
          onSubmit={onSubmit}
        />
      );
    });
    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.focus();
    disable();
    await waitFor(() => expect(editor).toHaveAttribute("aria-disabled", "true"));
    await fireEvent.keyDown(editor, { key: "a" });
    editor.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: "a", bubbles: true, cancelable: true }),
    );
    await fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor).toHaveTextContent("");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("does not submit when Enter confirms IME composition", async () => {
    const { editor, onSubmit } = renderComposer();

    await fireEvent.compositionStart(editor);
    await fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.compositionEnd(editor);
    await fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("leaves the key that starts an IME composition to the browser", async () => {
    const { editor, onValueChange } = renderComposer();

    await fireEvent.keyDown(editor, { key: "n", keyCode: 229 });
    await fireEvent.keyDown(editor, { key: "Process", keyCode: 229 });
    expect(onValueChange).not.toHaveBeenCalled();

    await fireEvent.compositionStart(editor);
    await typeQuery(editor, "你好");
    await fireEvent.compositionEnd(editor);
    expect(onValueChange).toHaveBeenLastCalledWith("你好");
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

  it("adds a line on plain Enter and sends on the modifier chord in modifier mode", async () => {
    const { editor, onSubmit, onValueChange } = renderComposer([], "", [], [], [], "meta-enter");

    await typeQuery(editor, "first");
    await fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("first\n"));
    expect(editor.textContent).toContain("\n");

    await fireEvent.keyDown(editor, { key: "Enter", metaKey: true, shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("sends on Ctrl+Enter in modifier mode on other platforms", async () => {
    const { editor, onSubmit } = renderComposer([], "", [], [], [], "ctrl-enter");

    await typeQuery(editor, "first");
    await fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(editor.textContent).toContain("first");
  });

  it("does not submit a Safari post-composition Enter in modifier mode", async () => {
    const { editor, onSubmit } = renderComposer([], "", [], [], [], "meta-enter");

    await fireEvent.compositionStart(editor);
    await typeQuery(editor, "にほんご");
    // Chromium: before compositionend, with isComposing.
    await fireEvent.keyDown(editor, { key: "Enter", keyCode: 229, isComposing: true });
    await fireEvent.compositionEnd(editor);
    // Safari: after compositionend, without isComposing.
    await fireEvent.keyDown(editor, { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();

    // The send chord during composition belongs to the IME too.
    await fireEvent.keyDown(editor, { key: "Enter", metaKey: true, keyCode: 229, isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("ComposerEditor window focus", () => {
  const fixtures: HTMLElement[] = [];

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    for (const element of fixtures.splice(0)) element.remove();
  });

  function fixture(html: string) {
    const element = document.createElement("div");
    element.innerHTML = html;
    document.body.append(element);
    fixtures.push(element);
    return element;
  }

  it("takes focus back when the window returns with nothing focused", () => {
    const { editor } = renderComposer();
    expect(editor).not.toHaveFocus();

    fireEvent(window, new Event("focus"));

    expect(editor).toHaveFocus();
  });

  it("leaves focus in an open dialog", () => {
    const { editor } = renderComposer();
    fixture('<div role="dialog" aria-label="Settings"><button type="button">Close</button></div>');
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();

    fireEvent(window, new Event("focus"));

    expect(close).toHaveFocus();
    expect(editor).not.toHaveFocus();
  });

  it("keeps a text selection outside the composer", () => {
    const { editor } = renderComposer();
    const transcript = fixture("<p>Copy this answer</p>");
    const range = document.createRange();
    range.selectNodeContents(transcript);
    document.getSelection()?.addRange(range);

    fireEvent(window, new Event("focus"));

    expect(editor).not.toHaveFocus();
    expect(document.getSelection()?.toString()).toBe("Copy this answer");
  });

  it("leaves a disabled composer alone", () => {
    render(() => (
      <ComposerEditor
        agentId="chief"
        agents={[]}
        attachments={[]}
        value=""
        placeholder="Message Chief"
        ariaLabel="Message Chief"
        disabled
        sendShortcut="enter"
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    ));

    fireEvent(window, new Event("focus"));

    expect(screen.getByRole("textbox", { name: "Message Chief" })).not.toHaveFocus();
  });
});
