import {
  PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY,
  PROVIDER_SIGN_IN_RELAY_V2_PROVIDERS,
  PROVIDER_SIGN_IN_RELAY_V2_ROUTES,
} from "./provider-sign-in-relay-v2";
import { SIGN_IN_RELAY_CAPABILITY, SIGN_IN_RELAY_PROVIDERS, SIGN_IN_RELAY_ROUTES } from "./sign-in-relay-v1";

export type ProviderSignInRelayProvider =
  | (typeof SIGN_IN_RELAY_PROVIDERS)[number]
  | (typeof PROVIDER_SIGN_IN_RELAY_V2_PROVIDERS)[number];

export interface ProviderSignInRelay {
  capability: typeof SIGN_IN_RELAY_CAPABILITY | typeof PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY;
  start: string;
  providers: readonly ProviderSignInRelayProvider[];
}

export const PROVIDER_SIGN_IN_RELAYS: readonly ProviderSignInRelay[] = [
  {
    capability: SIGN_IN_RELAY_CAPABILITY,
    start: SIGN_IN_RELAY_ROUTES.providerStart,
    providers: SIGN_IN_RELAY_PROVIDERS,
  },
  {
    capability: PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY,
    start: PROVIDER_SIGN_IN_RELAY_V2_ROUTES.start,
    providers: PROVIDER_SIGN_IN_RELAY_V2_PROVIDERS,
  },
];

export function providerSignInRelayProviders(
  supports: (capability: ProviderSignInRelay["capability"]) => boolean,
): readonly ProviderSignInRelayProvider[] {
  return PROVIDER_SIGN_IN_RELAYS.flatMap((relay) => (supports(relay.capability) ? relay.providers : []));
}

export function providerSignInRelay(
  provider: string,
  supports: (capability: ProviderSignInRelay["capability"]) => boolean,
): { relay: ProviderSignInRelay; provider: ProviderSignInRelayProvider } | null {
  for (const relay of PROVIDER_SIGN_IN_RELAYS) {
    const match = relay.providers.find((candidate) => candidate === provider);
    if (match && supports(relay.capability)) return { relay, provider: match };
  }
  return null;
}
