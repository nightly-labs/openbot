import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { ChevronDown, Input } from "@openbot/ui";
import { onCleanup, Show } from "solid-js";
import { useText } from "../../text";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarSectionEditor() {
  const {
    cancelSectionEditor,
    pending,
    releaseSectionNameInput,
    saveSectionEditor,
    setSectionNameInput,
    updateSectionEditorName,
  } = useSidebarScope();
  const { t } = useText();
  const editor = () => pending.sectionEditor;
  let element: HTMLInputElement | undefined;
  let stopWaitingForWindow: (() => void) | undefined;
  onCleanup(() => {
    stopWaitingForWindow?.();
    releaseSectionNameInput(element);
  });
  return (
    <header class="sidebar-section-editor-wrap">
      <Input
        ref={(input: HTMLInputElement) => {
          element = input;
          setSectionNameInput(input);
        }}
        class="sidebar-section-editor"
        value={editor()?.name ?? ""}
        onValueChange={updateSectionEditorName}
        maxlength={INPUT_LIMITS.sidebarSectionName}
        aria-label={
          editor()?.target.kind === "rename" ? t("sidebar.section.renameLabel") : t("sidebar.section.newNameLabel")
        }
        aria-invalid={editor()?.error ? "true" : undefined}
        title={editor()?.error ?? undefined}
        disabled={editor()?.saving === true}
        onKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void saveSectionEditor();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelSectionEditor();
          }
        }}
        onBlur={(event) => {
          const input = event.currentTarget;
          if (input.ownerDocument.activeElement !== input) {
            cancelSectionEditor();
            return;
          }
          const view = input.ownerDocument.defaultView;
          if (!view || stopWaitingForWindow) return;
          const recheck = () => {
            stopWaitingForWindow = undefined;
            if (input.ownerDocument.activeElement !== input) cancelSectionEditor();
          };
          view.addEventListener("focus", recheck, { once: true });
          stopWaitingForWindow = () => view.removeEventListener("focus", recheck);
        }}
      />
      <ChevronDown class="sidebar-section-editor-chevron size-4" aria-hidden="true" />
      <Show when={editor()?.error}>
        {(message) => (
          <span class="sr-only" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </header>
  );
}

export function SidebarSectionDraft(draftProps: { parentId: string | null }) {
  const { pending } = useSidebarScope();
  const { t } = useText();
  const here = () => {
    const target = pending.sectionEditor?.target;
    return target?.kind === "create" && (target.parentId ?? null) === draftProps.parentId;
  };
  return (
    <Show when={here()}>
      <section class="sidebar-chat-group sidebar-section sidebar-section-draft" aria-label={t("sidebar.new.section")}>
        <SidebarSectionEditor />
      </section>
    </Show>
  );
}
