// The account relays of the Team API, newest first. Each one is frozen in its own file; a client uses
// the newest one that a host advertises, and a host answers the start route of each one it advertises.
import {
  PROVIDER_ACCOUNT_RELAY_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_PROVIDERS,
  PROVIDER_ACCOUNT_RELAY_ROUTES,
} from "./provider-account-relay-v1";
import {
  PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS,
  PROVIDER_ACCOUNT_RELAY_V2_ROUTES,
} from "./provider-account-relay-v2";

export type ProviderAccountRelayProvider = (typeof PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS)[number];

/** One account relay: its capability, the route that starts an account's sign-in, and the providers it takes. */
export interface ProviderAccountRelay {
  capability: typeof PROVIDER_ACCOUNT_RELAY_CAPABILITY | typeof PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY;
  start: string;
  providers: readonly ProviderAccountRelayProvider[];
}

export const PROVIDER_ACCOUNT_RELAYS: readonly ProviderAccountRelay[] = [
  {
    capability: PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY,
    start: PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start,
    providers: PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS,
  },
  {
    capability: PROVIDER_ACCOUNT_RELAY_CAPABILITY,
    start: PROVIDER_ACCOUNT_RELAY_ROUTES.start,
    providers: PROVIDER_ACCOUNT_RELAY_PROVIDERS,
  },
];

/** The newest account relay that a host advertises, or null when it relays none. */
export function providerAccountRelay(
  supports: (capability: ProviderAccountRelay["capability"]) => boolean,
): ProviderAccountRelay | null {
  return PROVIDER_ACCOUNT_RELAYS.find((relay) => supports(relay.capability)) ?? null;
}
