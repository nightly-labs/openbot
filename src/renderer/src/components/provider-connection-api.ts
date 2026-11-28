import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import type { ProviderConnection } from "@openbot/ui/components/ProviderPicker";
import type { ProviderRegion } from "@openbot/ui/components/ProviderRegionDialog";

export type ProviderCodeLoginOpener = "composer" | "transfer";

export interface ProviderUseApp {
  provider: AgentProviderId;
  opener: ProviderCodeLoginOpener | null;
}

export interface ProviderRegionChoice {
  provider: AgentProviderId;
  opener: ProviderCodeLoginOpener | null;
  globalSite: string;
  mainlandChinaSite: string;
}

export interface ProviderConnectionApi extends ProviderConnection {
  provider: () => AgentProviderId | null;
  state: () => ProviderCodeLoginState;
  opener: () => ProviderCodeLoginOpener | null;
  connect: (provider: AgentProviderId, opener?: ProviderCodeLoginOpener) => Promise<void>;
  alternative: (provider: AgentProviderId, opener?: ProviderCodeLoginOpener) => void;
  useApp: () => ProviderUseApp | null;
  closeUseApp: () => void;
  regionChoice: () => ProviderRegionChoice | null;
  chooseRegion: (region: ProviderRegion | null) => void;
  openAppDownload?: (() => void) | undefined;
  submit: (code: string) => void;
  cancel: () => void;
  openVerificationUrl: (url: string) => void;
  openRelayPage: () => Promise<void>;
  pasteRelayAddress: (address: string) => Promise<void>;
}
