import type { Accessor } from "solid-js";
import type { ServerSettingsModalProps } from "./ServerSettingsModal";

/**
 * What the server settings dialog gives each section it builds. A section's panel unmounts while
 * another tab is selected, so the dialog creates each section once and the section keeps its state
 * here, not in the panel.
 */
export interface ServerSettingsSectionHost {
  props: ServerSettingsModalProps;
  local: Accessor<boolean>;
  configured: Accessor<boolean>;
  published: Accessor<boolean>;
  /** False while a remote server is offline: nothing can be changed there. */
  actionsAvailable: Accessor<boolean>;
  /** The dialog element, where menus and selects mount so that they stay inside its focus scope. */
  menuMount: Accessor<HTMLElement | undefined>;
  /** The key of the one action in flight, gating every panel at once rather than belonging to any. */
  busy: Accessor<string | null>;
  /** Runs one action under `busy`, shows its failure as a toast, and says whether it succeeded. */
  run(key: string, action: () => Promise<void>): Promise<boolean>;
  showCopyError(): void;
}
