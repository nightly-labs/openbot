import type { DraftAttachment, InstalledSkill } from "@openbot/contracts/ipc";
import { fireEvent, render, screen } from "@solidjs/testing-library";
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
});
