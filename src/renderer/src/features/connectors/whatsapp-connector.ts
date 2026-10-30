import type {
  MessagingDesktopApi,
  StartWhatsAppLinkInput,
  WhatsAppLinkState,
  WhatsAppOverview,
} from "@openbot/contracts/ipc";
import { WHATSAPP_LINK_IDLE } from "@openbot/ui/features/settings/WhatsAppIntegrationPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, untrack } from "solid-js";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
} from "./connector-controller";
import type { MessagingConnectorOptions } from "./messaging-connector";

/**
 * The WhatsApp requests to main. A number links by a code on the screen of the computer that runs
 * OpenBot, so only this computer has them; a joined server does not.
 */
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
>;

/** This computer's WhatsApp, through main. Read on each call: tests and stories replace `window.openbot`. */
export const whatsappPort = (): WhatsAppPort => window.openbot.messaging;

/** How often a page reads the numbers while it shows: a number changes on its own. */
const POLL_MS = 3_000;
/** How often the link dialog reads the link: the QR code changes about every 20 seconds. */
const LINK_POLL_MS = 1_000;

/**
 * The WhatsApp numbers of this computer. Main sends no event for a number or a link, so a page that
 * shows them calls `watch`, and a link that waits for the phone is read every second until it ends.
 * Each action reads the numbers again when it ends.
 */
export function createWhatsAppConnector(
  port: () => WhatsAppPort,
  options: MessagingConnectorOptions,
): ConnectorController {
  /** The last read. A failed read keeps the overview of an earlier one, and `error` says why it failed. */
  const [loaded, setLoaded] = createSignal<{ overview: WhatsAppOverview | null; error: string | null } | null>(null);
  const [link, setLink] = createSignal<WhatsAppLinkState>(WHATSAPP_LINK_IDLE);
  const overview = () => loaded()?.overview ?? null;
  const actions = createConnectorActions("connector.whatsapp.actionFailed", "whatsapp");
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
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

  /** Each link that starts or ends replaces the one before it, and stops its reads. */
  let links = 0;
  /** True from a start until the dialog ends the link. */
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
          // A failed read is tried again at the next tick; the link ends on its own when it times out.
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
  /** The dialog closed. A link that did not end in `linked` is cancelled, so the phone cannot use its code. */
  const endLink = () => {
    links += 1;
    stopLinkReads();
    const status = untrack(link).status;
    setLink(WHATSAPP_LINK_IDLE);
    if (!linkStarted) return;
    linkStarted = false;
    // It does not wait, so a start still on its way is replaced and its answer ignored.
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
