import type { ShortcutCommand } from "@openbot/ui/features/settings/keyboard-shortcuts";
import { onSettled } from "solid-js";
import { matchesShortcut } from "../../keyboard-shortcut-preference";

type WorkspaceShortcutCommand = Extract<ShortcutCommand, "newAgent" | "toggleSidebar" | "showShortcuts">;

export type WorkspaceShortcutActions = Partial<Record<WorkspaceShortcutCommand, () => boolean>>;

const WORKSPACE_SHORTCUT_COMMANDS: readonly WorkspaceShortcutCommand[] = ["newAgent", "toggleSidebar", "showShortcuts"];

export function insideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[role=dialog], [role=alertdialog], [role=menu]") !== null;
}

export function useWorkspaceShortcuts(actions: WorkspaceShortcutActions): void {
  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || insideOverlay(event.target)) return;
      const command = WORKSPACE_SHORTCUT_COMMANDS.find((candidate) => matchesShortcut(event, candidate));
      const action = command ? actions[command] : undefined;
      if (!action?.()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}
