import {
  decodeMcpSignInRelayPage,
  decodeSignInRelayFlow,
  decodeSignInRelayStatus,
  isGoogleConnectionPage,
  parseGoogleConnectionAssign,
  parseGoogleConnectionConfigure,
  parseGoogleConnectionProfile,
} from "@openbot/contracts/ipc";
import {
  GOOGLE_CONNECTIONS_CAPABILITY,
  GOOGLE_CONNECTIONS_ROUTES as R,
} from "@openbot/contracts/team-protocol/google-connections-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { GoogleConnectionsService } from "../google-connections-service";
import { decodeGoogleConnectionsFromHost } from "../remote-google-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import type { SignInRelayClient, SignInRelayRemote } from "../sign-in-relay-client";
import { runGoogleOperation } from "../team-api/route-google-connections";
import type { TeamStore } from "../team-store";
import { agentScope } from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { isObject, requireString } from "./validation";

interface GoogleConnectionsIpcDependencies {
  service: GoogleConnectionsService;
  team: Pick<TeamStore, "getOwnerMemberId" | "getIdentity">;
  remoteServers: Pick<RemoteServerManager, "request" | "supportsCapability">;
  relay: Pick<SignInRelayClient, "run" | "page" | "open" | "paste">;
}
export function googleConnectionsIpcHandlers({
  service,
  team,
  remoteServers,
  relay,
}: GoogleConnectionsIpcDependencies): Pick<IpcGroupHandlers, "googleConnections"> {
  const actor = () => ({
    member: { id: team.getOwnerMemberId() ?? "local-owner", role: "owner" as const },
    serverId: team.getIdentity()?.serverId ?? "local",
  });
  const pending = new Map<string, () => Promise<void>>();
  const key = (serverId: string) => `google\n${serverId}`;
  function requireSupport(serverId: string) {
    if (!remoteServers.supportsCapability(serverId, GOOGLE_CONNECTIONS_CAPABILITY))
      throw new Error(sourceText("error.team.googleConnectionUnavailable"));
  }
  const post = <T>(serverId: string, path: string, decode: (v: unknown) => T, body: unknown) => {
    requireSupport(serverId);
    return remoteServers.request(serverId, path, decode, { method: "POST", body, timeoutMs: 25_000 });
  };
  const state = (serverId: string) => runCauseEffect(post(serverId, R.state, decodeGoogleConnectionsFromHost, {}));
  async function signIn(profileId: string | null, serverId: string | null) {
    const k = key(serverId ?? "local");
    if (pending.has(k)) throw new Error(sourceText("error.team.googleConnectionUnavailable"));
    let canceled = false;
    pending.set(k, async () => {
      canceled = true;
    });
    const localActor = actor();
    const fail = () => new Error(sourceText("error.team.googleConnectionUnavailable"));
    let cancel: (() => Promise<void>) | null = null;
    try {
      const opened =
        serverId !== null
          ? await runCauseEffect(post(serverId, R.start, decodeSignInRelayFlow, { profileId }))
          : await runGoogleOperation(service.start(localActor, profileId));
      const adapter: SignInRelayRemote<Error> = {
        start: Effect.succeed(opened),
        status: (id) =>
          serverId !== null
            ? post(serverId, R.status, decodeSignInRelayStatus, { flowId: id }).pipe(Effect.mapError(fail))
            : service.status(localActor, id).pipe(Effect.mapError(fail)),
        complete: (id, query) =>
          serverId !== null
            ? post(serverId, R.complete, decodeSignInRelayStatus, { flowId: id, query }).pipe(Effect.mapError(fail))
            : service.complete(localActor, id, query).pipe(Effect.mapError(fail)),
        cancel: (id) =>
          serverId !== null
            ? post(serverId, R.cancel, () => undefined, { flowId: id }).pipe(Effect.mapError(fail))
            : service.cancel(localActor, id).pipe(Effect.mapError(fail)),
      };
      cancel = () => Effect.runPromise(adapter.cancel(opened.flowId).pipe(Effect.ignore));
      pending.set(k, cancel);
      if (canceled) throw fail();
      const first = await Effect.runPromise(adapter.status(opened.flowId));
      const url = new URL(first.authorizeUrl ?? "");
      // A user chose Google; a remote host cannot substitute another website.
      if (!isGoogleConnectionPage(url.toString())) throw fail();
      const result = await Effect.runPromise(relay.run(k, adapter, { page: url.toString(), onWaiting: () => {} }));
      if (result.error) throw new Error(result.error);
      return serverId !== null ? state(serverId) : service.snapshot(localActor);
    } finally {
      pending.delete(k);
      await cancel?.();
    }
  }
  return {
    googleConnections: {
      state: scopedQueryHandler({ local: () => service.snapshot(actor()), remote: state }),
      configure: scopedHandler(parseGoogleConnectionConfigure, {
        local: (p) => runGoogleOperation(service.configure(actor(), p.mcpServerId)),
        remote: (p, s) => runCauseEffect(post(s, R.configure, decodeGoogleConnectionsFromHost, p)),
      }),
      signIn: scopedHandler(parseGoogleConnectionProfile, {
        local: (p) => signIn(p.profileId, null),
        remote: (p, s) => signIn(p.profileId, s),
      }),
      assign: scopedHandler(parseGoogleConnectionAssign, {
        local: (p) => runGoogleOperation(service.assign(actor(), p)),
        remote: (p, s) => runCauseEffect(post(s, R.assign, decodeGoogleConnectionsFromHost, p)),
      }),
      disconnect: scopedHandler(parseGoogleConnectionProfile, {
        local: (p) => {
          if (!p.profileId) throw new Error("Invalid Google profile.");
          return runGoogleOperation(service.disconnect(actor(), p.profileId));
        },
        remote: (p, s) => runCauseEffect(post(s, R.disconnect, decodeGoogleConnectionsFromHost, p)),
      }),
      cancel: payloadHandler(agentScope, async (p) => {
        await pending.get(key(p.serverId ?? "local"))?.();
      }),
      page: payloadHandler(agentScope, (p) => decodeMcpSignInRelayPage(relay.page(key(p.serverId ?? "local")))),
      open: payloadHandler(agentScope, (p) => relay.open(key(p.serverId ?? "local"))),
      paste: scopedHandler(
        (v) => {
          if (!isObject(v)) throw new Error("Invalid Google callback.");
          return { address: requireString(v.address, "Address", 8192) };
        },
        { local: (p) => relay.paste(key("local"), p.address), remote: (p, s) => relay.paste(key(s), p.address) },
      ),
    },
  };
}
