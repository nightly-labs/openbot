import type { ChannelSummary, SidebarSection } from "@openbot/contracts/ipc";
import { createMemo, createStore } from "solid-js";
import { currentText } from "../../../text";
import type { SidebarProps } from "../sidebar-types";

interface SidebarPendingDelete {
  deleting: boolean;
  error: string | null;
  id: string;
  kind: "agent" | "channel" | "section";
}

type SidebarSectionEditorTarget =
  | { kind: "create"; agentId?: string; parentId?: string }
  | { kind: "rename"; sectionId: string };

interface SidebarSectionEditor {
  error: string | null;
  name: string;
  saving: boolean;
  target: SidebarSectionEditorTarget;
}

interface SidebarPending {
  deletion: SidebarPendingDelete | null;
  sectionEditor: SidebarSectionEditor | null;
}

export function createSidebarPendingStore(deps: {
  customSectionById: () => Map<string, SidebarSection>;
  props: SidebarProps;
}) {
  const { customSectionById, props } = deps;

  const [pending, setPending] = createStore<SidebarPending>({ deletion: null, sectionEditor: null });
  const deleting = () => pending.deletion?.deleting === true;
  const deleteError = () => pending.deletion?.error ?? null;
  let sectionNameInput: HTMLInputElement | undefined;

  const deleteTarget = createMemo(() => {
    const deletion = pending.deletion;
    return deletion?.kind === "agent" ? props.agents.find((agent) => agent.id === deletion.id) : undefined;
  });
  const channelDeleteTarget = createMemo<ChannelSummary | undefined>(() => {
    const deletion = pending.deletion;
    return deletion?.kind === "channel" ? props.channels?.find((channel) => channel.id === deletion.id) : undefined;
  });
  const sectionDeleteTarget = createMemo(() => {
    const deletion = pending.deletion;
    return deletion?.kind === "section"
      ? props.layout.sections.find((section) => section.id === deletion.id)
      : undefined;
  });

  function openDelete(kind: SidebarPendingDelete["kind"], id: string): void {
    setPending((state) => {
      state.deletion = { deleting: false, error: null, id, kind };
    });
  }

  function closeDelete(): void {
    setPending((state) => {
      state.deletion = null;
    });
  }

  function beginDelete(): void {
    setPending((state) => {
      if (!state.deletion) return;
      state.deletion.deleting = true;
      state.deletion.error = null;
    });
  }

  function failDelete(cause: unknown): void {
    setPending((state) => {
      if (!state.deletion) return;
      state.deletion.deleting = false;
      const text = currentText();
      state.deletion.error = text.errorMessage(cause, text.t("sidebar.delete.failed"));
    });
  }

  async function confirmDelete() {
    const deletion = pending.deletion;
    if (!deletion || deletion.deleting || (deletion.kind !== "agent" && deletion.kind !== "channel")) return;
    const onDelete = deletion.kind === "agent" ? props.onDeleteAgent : props.onDeleteChannel;
    if (!onDelete) return;
    beginDelete();
    try {
      await onDelete(deletion.id);
      closeDelete();
    } catch (error) {
      failDelete(error);
    }
  }

  const setSectionNameInput = (element: HTMLInputElement) => {
    sectionNameInput = element;
  };

  const releaseSectionNameInput = (element: HTMLInputElement | undefined) => {
    if (sectionNameInput === element) sectionNameInput = undefined;
  };

  function updateSectionEditorName(value: string): void {
    setPending((state) => {
      if (!state.sectionEditor) return;
      state.sectionEditor.name = value;
      state.sectionEditor.error = null;
    });
  }

  function focusSectionName(): void {
    queueMicrotask(() => {
      sectionNameInput?.focus();
      sectionNameInput?.select();
    });
  }

  function startCreateSection(agentId?: string, parentId?: string): void {
    props.onExpand();
    setPending((state) => {
      state.sectionEditor = {
        error: null,
        name: "",
        saving: false,
        target: { kind: "create", ...(agentId ? { agentId } : {}), ...(parentId ? { parentId } : {}) },
      };
    });
    focusSectionName();
  }

  function startRenameSection(sectionId: string): void {
    const section = customSectionById().get(sectionId);
    if (!section) return;
    props.onExpand();
    setPending((state) => {
      state.sectionEditor = { error: null, name: section.name, saving: false, target: { kind: "rename", sectionId } };
    });
    focusSectionName();
  }

  function cancelSectionEditor(): void {
    if (pending.sectionEditor?.saving) return;
    setPending((state) => {
      state.sectionEditor = null;
    });
  }

  function setSectionNameError(message: string): void {
    setPending((state) => {
      if (state.sectionEditor) state.sectionEditor.error = message;
    });
  }

  async function saveSectionEditor(): Promise<void> {
    const editor = pending.sectionEditor;
    if (!editor || editor.saving) return;
    const name = editor.name.trim();
    if (!name) {
      setSectionNameError(currentText().t("sidebar.section.nameRequired"));
      focusSectionName();
      return;
    }
    const target = editor.target;
    const duplicate = props.layout.sections.some(
      (section) =>
        section.name.toLocaleLowerCase() === name.toLocaleLowerCase() &&
        !(target.kind === "rename" && target.sectionId === section.id),
    );
    if (duplicate) {
      setSectionNameError(currentText().t("sidebar.section.nameUnique"));
      focusSectionName();
      return;
    }
    setPending((state) => {
      if (!state.sectionEditor) return;
      state.sectionEditor.error = null;
      state.sectionEditor.saving = true;
    });
    try {
      await props.onMutateLayout(
        target.kind === "create"
          ? {
              type: "create",
              name,
              ...(target.agentId ? { agentId: target.agentId } : {}),
              ...(target.parentId ? { parentId: target.parentId } : {}),
            }
          : { type: "rename", sectionId: target.sectionId, name },
      );
      setPending((state) => {
        state.sectionEditor = null;
      });
    } catch (error) {
      setPending((state) => {
        if (!state.sectionEditor) return;
        const text = currentText();
        state.sectionEditor.error = text.errorMessage(error, text.t("sidebar.section.saveFailed"));
        state.sectionEditor.saving = false;
      });
      focusSectionName();
    }
  }

  async function confirmSectionDelete(): Promise<void> {
    const deletion = pending.deletion;
    if (deletion?.kind !== "section" || deletion.deleting) return;
    beginDelete();
    try {
      await props.onMutateLayout({ type: "delete", sectionId: deletion.id });
      closeDelete();
    } catch (error) {
      failDelete(error);
    }
  }

  return {
    cancelSectionEditor,
    closeDelete,
    confirmDelete,
    confirmSectionDelete,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    openDelete,
    pending,
    releaseSectionNameInput,
    saveSectionEditor,
    sectionDeleteTarget,
    setSectionNameInput,
    startCreateSection,
    startRenameSection,
    updateSectionEditorName,
  };
}
