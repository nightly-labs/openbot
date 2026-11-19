import type {
  MessagingDesktopApi,
  StartWhatsAppLinkInput,
  WhatsAppLinkState,
  WhatsAppOverview,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { WHATSAPP_LINK_IDLE } from "@openbot/ui/features/settings/WhatsAppIntegrationPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, untrack } from "solid-js";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
} from "./connector-controller";
import type { MessagingConnectorOptions } from "./messaging-connector";

export type WhatsAppPort = Pick<
  MessagingDesktopApi,
  | "getWhatsAppOverview"
  | "startWhatsAppLink"
  | "getWhatsAppLinkState"
  | "cancelWhatsAppLink"
  | "disconnectWhatsAppNumber"
  | "reconnectWhatsAppNumber"
  | "setWhatsAppEnabled"
  | "addWhatsAppOrchestrator"
  | "listWhatsAppGroups"
  | "addWhatsAppSender"
  | "removeWhatsAppSender"
  | "answerWhatsAppRequest"
  | "setWhatsAppOwnNumber"
  | "setWhatsAppWorkingMessage"
  | "setWhatsAppStatusReactions"
>;

export const whatsappPort = (): WhatsAppPort => window.openbot.messaging;

export type HostWhatsAppApi = Pick<
  MessagingDesktopApi,
  | "hostGetWhatsAppOverview"
  | "hostStartWhatsAppLink"
  | "hostGetWhatsAppLinkState"
  | "hostCancelWhatsAppLink"
  | "hostDisconnectWhatsAppNumber"
  | "hostReconnectWhatsAppNumber"
  | "hostSetWhatsAppEnabled"
  | "hostAddWhatsAppOrchestrator"
  | "hostListWhatsAppGroups"
  | "hostAddWhatsAppSender"
  | "hostRemoveWhatsAppSender"
  | "hostAnswerWhatsAppRequest"
  | "hostSetWhatsAppOwnNumber"
  | "hostSetWhatsAppWorkingMessage"
  | "hostSetWhatsAppStatusReactions"
>;

export function hostWhatsAppPort(
  serverId: () => string | undefined,
  host: () => HostWhatsAppApi = () => window.openbot.messaging,
): WhatsAppPort {
  const call = <T>(method: (api: HostWhatsAppApi, serverId: string) => Promise<T>) => {
    const id = serverId();
    if (!id) return Promise.reject(new Error(sourceText("error.team.connectorsUnsupported")));
    return method(host(), id);
  };
  return {
    getWhatsAppOverview: () => call((api, id) => api.hostGetWhatsAppOverview(id)),
    startWhatsAppLink: (input) => call((api, id) => api.hostStartWhatsAppLink(input, id)),
    getWhatsAppLinkState: () => call((api, id) => api.hostGetWhatsAppLinkState(id)),
    cancelWhatsAppLink: () => call((api, id) => api.hostCancelWhatsAppLink(id)),
    disconnectWhatsAppNumber: (input) => call((api, id) => api.hostDisconnectWhatsAppNumber(input, id)),
    reconnectWhatsAppNumber: (input) => call((api, id) => api.hostReconnectWhatsAppNumber(input, id)),
    setWhatsAppEnabled: (input) => call((api, id) => api.hostSetWhatsAppEnabled(input, id)),
    addWhatsAppOrchestrator: () => call((api, id) => api.hostAddWhatsAppOrchestrator(id)),
    listWhatsAppGroups: (input) => call((api, id) => api.hostListWhatsAppGroups(input, id)),
    addWhatsAppSender: (input) => call((api, id) => api.hostAddWhatsAppSender(input, id)),
    removeWhatsAppSender: (input) => call((api, id) => api.hostRemoveWhatsAppSender(input, id)),
    answerWhatsAppRequest: (input) => call((api, id) => api.hostAnswerWhatsAppRequest(input, id)),
    setWhatsAppOwnNumber: (input) => call((api, id) => api.hostSetWhatsAppOwnNumber(input, id)),
    setWhatsAppWorkingMessage: (input) => call((api, id) => api.hostSetWhatsAppWorkingMessage(input, id)),
    setWhatsAppStatusReactions: (input) => call((api, id) => api.hostSetWhatsAppStatusReactions(input, id)),
  };
}

const POLL_MS = 3_000;
const LINK_POLL_MS = 1_000;

export function createWhatsAppConnector(
  port: () => WhatsAppPort,
  options: MessagingConnectorOptions,
): ConnectorController {
  const [loaded, setLoaded] = createSignal<{ overview: WhatsAppOverview | null; error: string | null } | null>(null);
  const [link, setLink] = createSignal<WhatsAppLinkState>(WHATSAPP_LINK_IDLE);
  const overview = () => loaded()?.overview ?? null;
  const actions = createConnectorActions("connector.whatsapp.actionFailed", "whatsapp");
  let reads = 0;

  const reload = () => {
    const read = ++reads;
    void port()
      .getWhatsAppOverview()
      .then((next) => {
        if (actions.disposed() || read !== reads) return;
        setLoaded({ overview: next, error: null });
      })
      .catch((error: unknown) => {
        if (actions.disposed() || read !== reads) return;
        const { t, errorMessage } = currentText();
        setLoaded({ overview: untrack(overview), error: errorMessage(error, t("connector.readFailed")) });
      });
  };
  const run = (action: () => Promise<unknown>, track?: ConnectorAnalyticsAction) =>
    actions.run(action, { settled: reload, ...(track ? { track } : {}) });

  let links = 0;
  let linkStarted = false;
  let linkTimer: ReturnType<typeof setInterval> | undefined;
  const stopLinkReads = () => {
    if (linkTimer !== undefined) clearInterval(linkTimer);
    linkTimer = undefined;
  };
  onCleanup(stopLinkReads);
  const follow = (state: WhatsAppLinkState, current: number) => {
    if (actions.disposed() || current !== links) return;
    setLink(state);
    if (state.status === "waiting") return;
    stopLinkReads();
    if (state.status === "linked") reload();
  };
  const startLink = (input: StartWhatsAppLinkInput) => {
    if (actions.busy()) return;
    const current = ++links;
    stopLinkReads();
    setLink(WHATSAPP_LINK_IDLE);
    linkStarted = true;
    actions.run(() => port().startWhatsAppLink(input), {
      track: "connect_started",
      done: (state) => {
        follow(state, current);
        if (state.status !== "waiting" || current !== links) return;
        linkTimer = setInterval(() => {
          void port()
            .getWhatsAppLinkState()
            .then(
              (next) => follow(next, current),
              () => undefined,
            );
        }, LINK_POLL_MS);
      },
    });
  };
  const endLink = () => {
    links += 1;
    stopLinkReads();
    const status = untrack(link).status;
    setLink(WHATSAPP_LINK_IDLE);
    if (!linkStarted) return;
    linkStarted = false;
    if (status !== "linked") actions.run(() => port().cancelWhatsAppLink(), { waits: false });
  };

  const connections = () => overview()?.connections ?? [];
  return {
    id: "whatsapp",
    ready: () => loaded() !== null,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: () => {
      reload();
      const timer = setInterval(reload, POLL_MS);
      return () => clearInterval(timer);
    },
    detail: {
      id: "whatsapp",
      props: {
        get agents() {
          return options.agents();
        },
        get hostName() {
          return options.hostName?.();
        },
        get connections() {
          return connections();
        },
        get accounts() {
          return overview()?.accounts ?? [];
        },
        get busy() {
          return actions.busy();
        },
        get models() {
          return options.models?.();
        },
        get link() {
          return link();
        },
        get loadError() {
          return loaded()?.error ?? null;
        },
        onRetry: reload,
        onStartLink: startLink,
        onEndLink: endLink,
        onDisconnectNumber: (workspaceId) =>
          run(() => port().disconnectWhatsAppNumber({ workspaceId }), "disconnected"),
        onDisconnectAll: () => {
          const workspaceIds = untrack(connections).map((connection) => connection.workspaceId);
          run(async () => {
            for (const workspaceId of workspaceIds) await port().disconnectWhatsAppNumber({ workspaceId });
          }, "disconnected");
        },
        onReconnect: (workspaceId) => run(() => port().reconnectWhatsAppNumber({ workspaceId }), "connect_started"),
        onSetEnabled: (workspaceId, enabled) =>
          run(() => port().setWhatsAppEnabled({ workspaceId, enabled }), enabled ? "enabled" : "disabled"),
        onSetOwnNumber: (workspaceId, ownNumber) => run(() => port().setWhatsAppOwnNumber({ workspaceId, ownNumber })),
        onSetWorkingMessage: (workspaceId, workingMessage) =>
          run(() => port().setWhatsAppWorkingMessage({ workspaceId, workingMessage })),
        onSetStatusReactions: (workspaceId, statusReactions) =>
          run(() => port().setWhatsAppStatusReactions({ workspaceId, statusReactions })),
        onAddOrchestrator: (choice) =>
          run(async () => {
            const { sectionId } = await port().addWhatsAppOrchestrator({ ...(choice ?? {}) });
            if (sectionId) options.onOrchestratorSection?.(sectionId);
          }),
        loadGroups: async (workspaceId) => (await port().listWhatsAppGroups({ workspaceId })).groups,
        onAddSender: (workspaceId, sender) => run(() => port().addWhatsAppSender({ workspaceId, sender })),
        onRemoveSender: (workspaceId, senderId) => run(() => port().removeWhatsAppSender({ workspaceId, senderId })),
        onAnswerRequest: (workspaceId, code, approve) =>
          run(() => port().answerWhatsAppRequest({ workspaceId, code, approve })),
      },
    },
  };
}
