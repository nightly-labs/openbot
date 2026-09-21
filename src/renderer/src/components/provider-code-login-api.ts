/**
 * What a surface needs to run a code sign-in, as one optional prop.
 *
 * Grouped like `ProviderKeyApi` is for Settings, and for the same reason: onboarding and the
 * settings modal both offer the sign-in and are both rendered from stories and tests with no
 * provider behind them, so the whole feature is one object that is either there or not, rather
 * than six callbacks each surface has to remember to pass together.
 *
 * The flow itself lives in the providers store. Everything here is a reader or a verb, because the
 * dialog that ends up on screen decides nothing: the phase arrives from main, and the ending
 * closes the dialog and becomes a notification the store raises.
 */

import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";

export interface ProviderCodeLoginApi {
  /** The provider whose dialog is open, or null while none is. */
  provider: () => AgentProviderId | null;
  state: () => ProviderCodeLoginState;
  /** Asks the provider for a code and opens the dialog on it. */
  start: (provider: AgentProviderId) => void;
  /** Gives up: the code stops working and the dialog closes. */
  cancel: () => void;
  /** Opens the verification page here, for the user who is on this computer after all. */
  openVerificationUrl: (url: string) => void;
}
