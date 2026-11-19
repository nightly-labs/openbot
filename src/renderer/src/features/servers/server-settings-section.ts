import type { Accessor } from "solid-js";
import type { ServerSettingsModalProps } from "./ServerSettingsModal";

export interface ServerSettingsSectionHost {
  props: ServerSettingsModalProps;
  local: Accessor<boolean>;
  configured: Accessor<boolean>;
  published: Accessor<boolean>;
  actionsAvailable: Accessor<boolean>;
  menuMount: Accessor<HTMLElement | undefined>;
  busy: Accessor<string | null>;
  run(key: string, action: () => Promise<void>): Promise<boolean>;
  showCopyError(): void;
}
