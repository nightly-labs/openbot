import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { CentralAuthManager } from "./central-auth-manager";
import { RemoteWorkflowError } from "./remote-service-effects";

interface MobileConnectHostDependencies {
  centralAuth: Pick<CentralAuthManager, "createMobileConnect">;
  host: {
    configure(input: { serverName: string }): Effect.Effect<unknown, RemoteWorkflowError>;
    getStatus(): { configured: boolean };
    getMobileConnectHost(): MobileConnectHostBinding | null;
    start(): Effect.Effect<
      {
        serverId: string | null;
        phase: string;
        apiOnline: boolean;
        apiUrl: string | null;
        message: string | null;
      },
      RemoteWorkflowError
    >;
  };
}

export const createHostedMobileConnect = Effect.fn("MobileConnectHost.create")(function* ({
  centralAuth,
  host,
}: MobileConnectHostDependencies) {
  if (!host.getStatus().configured) yield* host.configure({ serverName: "OpenBot" });
  const status = yield* host.start();
  if (!isPublishedHost(status)) {
    return yield* new RemoteWorkflowError({
      cause: new Error(status.message ?? sourceText("error.host.mobileConnectPublishFailed")),
    });
  }
  const binding = host.getMobileConnectHost();
  if (!binding || binding.hostId !== status.serverId)
    return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.mobileConnectHostChanged")) });
  return yield* centralAuth.createMobileConnect(binding);
});

function isPublishedHost(status: { phase: string; apiOnline: boolean; apiUrl: string | null }): boolean {
  if (status.phase !== "online" || !status.apiOnline || !status.apiUrl) return false;
  try {
    const protocol = new URL(status.apiUrl).protocol;
    return protocol === "ws:" || protocol === "wss:";
  } catch {
    return false;
  }
}
