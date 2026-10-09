import type { HostStatus, ServerNotificationLevel, ServerSummary } from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { WAKE_RECONNECT_STATES } from "@openbot/team-client/hosted-server-wake";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import { FALLBACK_HOST_STATUS } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import { watchHostUpdate } from "./host-update-toast";
import { olderAppSide, remoteUpdateServer, serverSupportsCapability } from "./server-capabilities";
import { serversPort } from "./servers-port";

/**
 * The workspaces the user can switch between - the local one this computer
 * hosts and every remote team server joined - plus the status of the host this
 * computer runs itself.
 *
 * Two things are deliberately *not* here, and both are the same rule: a domain
 * never reaches into one nested under it.
 *
 * - **`selectServer` stays in the controller.** It tears down and refetches
 *   agents, conversation, direct messages, turns, browser tabs and the sidebar -
 *   every domain that sits below this one. It moves here (or into the keyed
 *   scope that replaces it) once those domains own their own teardown, which is
 *   what the scoped-provider step does.
 * - **`serverLoadRequest` is how this domain asks for that anyway.** A retried
 *   incompatible host, or a remote that only just reported its version, has to
 *   be loaded again the moment the summaries say so. Rather than call downward,
 *   `applyServerSummaries` publishes the request and the active server scope reloads its data.
 *   It uses the same `{ id, nonce }` shape the renderer already uses for
 *   `settingsRequest` and `messageFocusRequest`. The nonce is load-bearing: the
 *   same server can need loading twice in a row.
 *
 * `initialServersReady` exists for the same reason. The first `list()` read is
 * this domain's, but the per-server bootstrap that runs after it belongs to the
 * domains below, so they get the promise instead of the read.
 *
 * Ungated - see `app-providers.tsx` for why no provider gates during the
 * migration. `activeServerId()` answers `"local"` before the list arrives, which
 * is the same answer it gives for the local workspace, so nothing below has to
 * distinguish "not loaded yet" from "local".
 */
const Servers = createSimpleContext({
  name: "Servers",
  init: () => {
    const [serversLoaded, setServersLoaded] = createSignal(false);
    const [serversLoadFailed, setServersLoadFailed] = createSignal(false);
    const [servers, setServers] = createSignal<ServerSummary[]>([]);
    const [hostStatus, setHostStatus] = createSignal<HostStatus>(FALLBACK_HOST_STATUS);
    const [joinServerOpen, setJoinServerOpen] = createSignal(false);
    const [addServerOpen, setAddServerOpen] = createSignal(false);
    // True when the account can create hosted servers. The plus button then opens the plans.
    const [hostedServersAvailable, setHostedServersAvailable] = createSignal(false);
    /** The hosted servers of this account. The server menu can delete these. */
    const [hostedServerIds, setHostedServerIds] = createSignal<ReadonlySet<string>>(new Set());
    const [serverLoadRequest, setServerLoadRequest] = createSignal<{ serverId: string; nonce: number } | null>(null);
    let loadRequestNonce = 0;
    let pendingCompatibilityRetryServerId: string | null = null;
    let serverSelectionGeneration = 0;

    /**
     * A token for "no other server selection has started since this point".
     *
     * The counter lives here because two unrelated callers need the same
     * answer: whoever runs the switch, and `closeBrowserTab`, which must not
     * apply a close that raced a switch. Neither can read the other's local, and
     * `activeServerId()` alone is not enough - it only changes once
     * `servers.select()` resolves, so it says "unchanged" for the whole window
     * in which a switch is already under way.
     *
     * `beginServerSelection` claims the next generation and invalidates every
     * predicate handed out before it; `currentServerSelection` only observes.
     * Both return the predicate rather than the number so no caller can compare
     * generations across owners - a comparison that stops meaning anything once
     * the counter lives inside a keyed scope.
     */
    function beginServerSelection(): () => boolean {
      const generation = ++serverSelectionGeneration;
      return () => generation === serverSelectionGeneration;
    }

    function currentServerSelection(): () => boolean {
      const generation = serverSelectionGeneration;
      return () => generation === serverSelectionGeneration;
    }

    const activeServer = createMemo(() => servers().find((server) => server.active));
    const activeServerId: () => string = createMemo((): string => activeServer()?.id ?? "local");

    function activeServerSupportsCapability(capability: TeamCurrentCapability): boolean {
      return serverSupportsCapability(activeServer(), capability);
    }

    // The account service stops a hosted server that nobody uses. The selected server starts again on the
    // user's next key or pointer press, not when the app only shows it.
    createEffect(
      () => {
        const server = activeServer();
        return server?.hostedSleep === "sleeping" ? server.id : null;
      },
      (serverId) => {
        if (!serverId) return;
        let active = true;
        const addListeners = () => {
          window.addEventListener("pointerdown", wake, true);
          window.addEventListener("keydown", wake, true);
        };
        const removeListeners = () => {
          window.removeEventListener("pointerdown", wake, true);
          window.removeEventListener("keydown", wake, true);
        };
        const wake = () => {
          removeListeners();
          // A wake that does not start the server leaves it asleep, so the next input asks again.
          void serversPort()
            .hostedServers.wake(serverId)
            .then(
              (server) => WAKE_RECONNECT_STATES.has(server.state),
              () => false,
            )
            .then((started) => {
              if (!started && active) addListeners();
            });
        };
        addListeners();
        return () => {
          active = false;
          removeListeners();
        };
      },
    );

    /** Opens Server Settings > Updates. The settings context below this one sets it. */
    let openHostUpdate: ((serverId: string) => void) | undefined;
    function setHostUpdateOpener(opener: ((serverId: string) => void) | undefined): void {
      openHostUpdate = opener;
    }

    /** The connection of each admin server whose update status was read, so each connection reads it once. */
    const updateChecks = new Map<string, number>();
    /** `serverId:sequence` of each version mismatch notice that already offered the update. */
    const mismatchOffers = new Set<string>();

    function applyServerSummaries(value: ServerSummary[]): void {
      setServersLoaded(true);
      setServersLoadFailed(false);
      const previous = new Map(servers().map((server) => [server.id, server]));
      for (const server of value) {
        const sequence = server.connectionSequence ?? 0;
        const previousSequence = previous.get(server.id)?.connectionSequence ?? 0;
        const compatibility = server.compatibility;
        const canUpdate = remoteUpdateServer(server);
        if (
          server.kind === "remote" &&
          sequence > previousSequence &&
          compatibility?.hostAppVersion &&
          compatibility.hostAppVersion !== compatibility.localAppVersion
        ) {
          const { t } = currentText();
          const opener = openHostUpdate;
          const serverId = server.id;
          const older = olderAppSide(compatibility.localAppVersion, compatibility.hostAppVersion);
          const descriptionParams = {
            name: server.name,
            protocol: String(compatibility.negotiatedProtocol),
            clientVersion: compatibility.localAppVersion,
            hostVersion: compatibility.hostAppVersion,
          };
          // The host action does not help when this app is the older side.
          const offerUpdate = opener && canUpdate && older !== "client";
          toast.warning(t("server.compatibility.versionMismatchTitle", { name: server.name }), {
            ...{
              description:
                older === "host"
                  ? t("server.compatibility.versionMismatchUpdateHostDescription", descriptionParams)
                  : older === "client"
                    ? t("server.compatibility.versionMismatchUpdateClientDescription", descriptionParams)
                    : t("server.compatibility.versionMismatchDescription", descriptionParams),
              action:
                opener && offerUpdate
                  ? { label: t("server.update.hostAction"), onClick: () => opener(serverId) }
                  : undefined,
            },
            report: { operation: "team", source: "system", cause_code: "unknown" },
          });
          if (offerUpdate) mismatchOffers.add(`${serverId}:${sequence}`);
        }
        // An admin learns about a new version, or sees the download that runs, when the host connects.
        if (canUpdate && server.state === "online" && updateChecks.get(server.id) !== sequence) {
          updateChecks.set(server.id, sequence);
          const opener = openHostUpdate;
          const serverId = server.id;
          watchHostUpdate({
            serverId,
            name: server.name,
            calls: serversPort().hostAdmin,
            ...(opener ? { openUpdates: () => opener(serverId) } : {}),
            offer: !mismatchOffers.has(`${serverId}:${sequence}`),
          });
        }
      }
      setServers(value);
      const retryTarget = value.find(
        (server) => server.id === pendingCompatibilityRetryServerId && server.active && server.state === "online",
      );
      const negotiatedTarget = value.find((server) => {
        const oldCompatibility = previous.get(server.id)?.compatibility;
        return (
          server.kind === "remote" &&
          server.active &&
          server.state === "online" &&
          oldCompatibility?.hostAppVersion === null &&
          Boolean(server.compatibility?.hostAppVersion)
        );
      });
      const reconnectedTarget = value.find((server) => {
        const old = previous.get(server.id);
        return (
          old?.active &&
          server.active &&
          server.kind === "remote" &&
          server.state === "online" &&
          (old.state !== "online" || (server.connectionSequence ?? 0) > (old.connectionSequence ?? 0))
        );
      });
      const loadTarget = retryTarget ?? negotiatedTarget ?? reconnectedTarget;
      if (loadTarget) {
        pendingCompatibilityRetryServerId = null;
        loadRequestNonce += 1;
        setServerLoadRequest({ serverId: loadTarget.id, nonce: loadRequestNonce });
      }
    }

    async function refreshServers(): Promise<void> {
      setServersLoadFailed(false);
      try {
        applyServerSummaries(await serversPort().servers.list());
      } catch {
        setServersLoadFailed(true);
      }
    }

    let markServersLoaded: () => void = () => undefined;
    const initialServersReady = new Promise<void>((resolve) => {
      markServersLoaded = resolve;
    });

    onSettled(() => {
      const unsubscribeServers = serversPort().servers.onEvent((value) => flush(() => applyServerSummaries(value)));
      const unsubscribeHost = serversPort().host.onEvent((status) => flush(() => setHostStatus(status)));
      // One `then` rather than a `then`/`catch`/`finally` chain: every extra link
      // is another microtask between the summaries arriving and the per-server
      // bootstrap that waits on this promise, and that gap is long enough for the
      // view to paint a first pass from stale state.
      void refreshServers().finally(markServersLoaded);
      void serversPort()
        .host.getStatus()
        .then(setHostStatus)
        .catch(() => undefined);
      void refreshHostedServersAvailable();
      // Another account can sign in after the start, so the plus button reads its access again.
      let signedInUserId: string | null = null;
      const unsubscribeAuth = serversPort().auth.onEvent((state) => {
        if (state.status !== "signed_in" && state.status !== "signed_out") return;
        const userId = state.status === "signed_in" ? state.user.id : null;
        if (userId === signedInUserId) return;
        signedInUserId = userId;
        if (userId) void refreshHostedServersAvailable();
        else {
          setHostedServersAvailable(false);
          setHostedServerIds(new Set<string>());
        }
      });
      return () => {
        unsubscribeServers();
        unsubscribeHost();
        unsubscribeAuth();
      };
    });

    /**
     * Reads again whether the account can create hosted servers, and which hosted servers it has. The
     * account can change after the start.
     */
    async function refreshHostedServersAvailable(): Promise<boolean> {
      // A failed read keeps the last answer: a network error does not turn the plans off.
      const list = await serversPort()
        .hostedServers.list()
        .catch(() => null);
      if (!list) return hostedServersAvailable();
      setHostedServersAvailable(list.available);
      setHostedServerIds(new Set(list.servers.map((server) => server.serverId)));
      return list.available;
    }

    // A server that the add server dialog creates comes into the list as an owned remote server. Each
    // owned server is read once, so a server that another computer of this account runs is not read again.
    const readOwnedServerIds = new Set<string>();
    createEffect(
      () =>
        servers()
          .filter((server) => server.kind === "remote" && server.role === "owner" && !readOwnedServerIds.has(server.id))
          .map((server) => server.id),
      (serverIds) => {
        if (serverIds.length === 0) return;
        for (const serverId of serverIds) readOwnedServerIds.add(serverId);
        void refreshHostedServersAvailable();
      },
    );

    async function retryServerConnection(serverId: string): Promise<void> {
      pendingCompatibilityRetryServerId = serverId;
      try {
        await serversPort().servers.retryConnection(serverId);
      } catch (error) {
        pendingCompatibilityRetryServerId = null;
        const text = currentText();
        actionToast.error(text.t("server.connection.failedTitle"), {
          ...{
            description: text.errorMessage(error, text.t("server.connection.failedDescription")),
          },
          report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
        });
      }
    }

    // No duration mutes until the user unmutes.
    async function setServerMuted(serverId: string, muted: boolean, durationMs?: number): Promise<void> {
      try {
        applyServerSummaries(
          await serversPort().servers.setMuted(
            durationMs === undefined ? { serverId, muted } : { serverId, muted, durationMs },
          ),
        );
      } catch (error) {
        const text = currentText();
        actionToast.error(text.t("server.notifications.changeFailedTitle"), {
          ...{
            description: text.errorMessage(error, text.t("server.notifications.changeFailedDescription")),
          },
          report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
        });
      }
    }

    async function setServerNotificationLevel(serverId: string, level: ServerNotificationLevel): Promise<void> {
      try {
        applyServerSummaries(await serversPort().servers.setNotificationLevel({ serverId, level }));
      } catch (error) {
        const text = currentText();
        actionToast.error(text.t("server.notifications.changeFailedTitle"), {
          ...{
            description: text.errorMessage(error, text.t("server.notifications.changeFailedDescription")),
          },
          report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
        });
      }
    }

    async function reorderServers(serverIds: string[]): Promise<void> {
      const previous = servers();
      const serversById = new Map(previous.map((server) => [server.id, server]));
      setServers([
        ...previous.filter((server) => server.kind === "local"),
        ...serverIds.flatMap((serverId) => {
          const server = serversById.get(serverId);
          return server?.kind === "remote" ? [server] : [];
        }),
      ]);
      try {
        setServers(await serversPort().servers.reorder({ serverIds }));
      } catch (error) {
        setServers(previous);
        throw error;
      }
    }

    return {
      servers,
      serversLoaded,
      serversLoadFailed,
      refreshServers,
      setServers,
      setHostUpdateOpener,
      activeServer,
      activeServerId,
      activeServerSupportsCapability,
      hostStatus,
      setHostStatus,
      joinServerOpen,
      setJoinServerOpen,
      addServerOpen,
      setAddServerOpen,
      hostedServersAvailable,
      hostedServerIds,
      refreshHostedServersAvailable,
      reorderServers,
      setServerMuted,
      setServerNotificationLevel,
      retryServerConnection,
      serverLoadRequest,
      initialServersReady,
      beginServerSelection,
      currentServerSelection,
    };
  },
});

export const ServersProvider = Servers.provider;
export const useServers = Servers.use;
