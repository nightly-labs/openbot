import { browserAddressPasteSupported } from "@openbot/contracts/agent-providers";
import { type AgentProviderId, agentProviderDescriptor, type ServerSummary } from "@openbot/contracts/ipc";
import {
  hostSignInProviders,
  localCodeSignInProviders,
  relaySignInProviders,
  serverCodeRouteProviders,
} from "../servers/server-capabilities";

export type ProviderSignInMethod = "browser" | "relay" | "host-page" | "code" | "use-app" | "address";

export type ProviderCodeLoginMethod = Extract<ProviderSignInMethod, "relay" | "host-page" | "code" | "address">;

export type ProviderConnectPlace =
  | { kind: "computer"; platform: string | undefined }
  | { kind: "app-server" | "web-server"; server: ServerSummary | undefined };

export interface ProviderConnectRoute {
  connect: ProviderSignInMethod | null;
  alternative: ProviderSignInMethod | null;
  addressWhileSigningIn?: boolean;
}

const NO_ROUTE: ProviderConnectRoute = { connect: null, alternative: null };

export function providerConnectRoute(
  provider: AgentProviderId,
  place: ProviderConnectPlace | null,
): ProviderConnectRoute {
  if (!place) return NO_ROUTE;
  if (place.kind === "computer") {
    return {
      connect: "browser",
      alternative: localCodeSignInProviders(place.platform).includes(provider) ? "code" : null,
      addressWhileSigningIn: place.platform !== undefined && browserAddressPasteSupported(provider, place.platform),
    };
  }
  const code = serverCodeRouteProviders(place.server).includes(provider);
  const hostPage = hostSignInProviders(place.server).includes(provider);
  const relay = relaySignInProviders(place.server).includes(provider);
  if (place.kind === "app-server") {
    const connect = relay ? "relay" : hostPage ? "host-page" : code ? "code" : null;
    return { connect, alternative: connect !== "code" && code ? "code" : null };
  }
  const connect = code
    ? "code"
    : hostPage
      ? "host-page"
      : relay && agentProviderDescriptor(provider).signInPageEnd === "page"
        ? "relay"
        : relay
          ? "use-app"
          : null;
  return { connect, alternative: connect !== "relay" && relay ? "relay" : null };
}
