import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { CentralAuthManager, RelayCaller } from "./central-auth-manager";

export type NearGatewayOwner = "server" | "personal";

export interface NearIntentsGateway {
  owners(): NearGatewayOwner[];
  fetch(owner: NearGatewayOwner): typeof fetch;
}

const RELAY_PREFIX = "/v1/near";
const OWNERS: readonly NearGatewayOwner[] = ["server", "personal"];

function skipPreconnect(_url: string | URL): void {}

export interface NearIntentsGatewayOptions {
  auth: Pick<CentralAuthManager, "hasSession" | "hostSiteCredential" | "relayFetch">;
  hostId: () => string | null;
  serverWallet: boolean;
}

export function createNearIntentsGateway({
  auth,
  hostId,
  serverWallet,
}: NearIntentsGatewayOptions): NearIntentsGateway {
  const caller = (owner: NearGatewayOwner): RelayCaller | null => {
    if (owner === "personal") return !serverWallet && auth.hasSession() ? { kind: "personal" } : null;
    const id = hostId();
    return id && auth.hostSiteCredential(id) ? { kind: "server", hostId: id } : null;
  };
  const relay = (owner: NearGatewayOwner): typeof fetch => {
    const send = async (input: RequestInfo | URL, init?: RequestInit) => {
      const current = caller(owner);
      if (!current) throw new Error(sourceText("error.connector.nearSignIn"));
      const url = new URL(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      headers.delete("x-api-key");
      return Effect.runPromise(
        auth.relayFetch(current, `${RELAY_PREFIX}${url.pathname}${url.search}`, { ...init, headers }),
      );
    };
    return Object.assign(send, { preconnect: skipPreconnect });
  };
  return {
    owners: () => OWNERS.filter((owner) => caller(owner) !== null),
    fetch: relay,
  };
}
