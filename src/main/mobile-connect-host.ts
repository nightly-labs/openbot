import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { CentralAuthOperationError } from "./central-auth-effects";
import type { CentralAuthManager } from "./central-auth-manager";
import { RemoteWorkflowError } from "./remote-service-effects";

interface MobileConnectHostDependencies<Operation extends keyof CentralAuthManager> {
  centralAuth: Pick<CentralAuthManager, Operation>;
  host: {
    configure(input: { serverName: string }): Effect.Effect<unknown, RemoteWorkflowError>;
    getStatus(): { configured: boolean };
    getMobileConnectHost(): MobileConnectHostBinding | null;
    refreshRegistration(): Effect.Effect<void, RemoteWorkflowError>;
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
}: MobileConnectHostDependencies<"createMobileConnect">) {
  return yield* withRegisteredHost(host, (binding) => centralAuth.createMobileConnect(binding));
});

export const createHostedMobileConnectLink = Effect.fn("MobileConnectHost.createLink")(function* ({
  centralAuth,
  host,
}: MobileConnectHostDependencies<"createMobileConnectLink">) {
  return yield* withRegisteredHost(host, (binding) => centralAuth.createMobileConnectLink(binding));
});

/**
 * A start of a running host does not register it, so the account service can keep another key for it,
 * for example after a key change whose answer was lost. Then the host registers again, which sends that
 * change first, and the request runs one more time (#9369).
 */
function withRegisteredHost<A, R>(
  host: MobileConnectHostDependencies<never>["host"],
  request: (binding: MobileConnectHostBinding) => Effect.Effect<A, CentralAuthOperationError, R>,
): Effect.Effect<A, CentralAuthOperationError | RemoteWorkflowError, R> {
  return Effect.flatMap(publishMobileConnectHost(host), request).pipe(
    Effect.catchIf(isHostMismatch, () =>
      host.refreshRegistration().pipe(
        Effect.andThen(publishMobileConnectHost(host)),
        Effect.flatMap(request),
        Effect.catchIf(
          isHostMismatch,
          () => new RemoteWorkflowError({ cause: new Error(sourceText("error.host.mobileConnectHostMismatch")) }),
        ),
      ),
    ),
  );
}

function isHostMismatch(error: CentralAuthOperationError | RemoteWorkflowError): boolean {
  const { cause } = error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "mobile_host_mismatch";
}

/** Starts the host, so the phone that uses the code can reach it, and returns its identity. */
const publishMobileConnectHost = Effect.fn("MobileConnectHost.publish")(function* (
  host: MobileConnectHostDependencies<never>["host"],
) {
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
  return binding;
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
