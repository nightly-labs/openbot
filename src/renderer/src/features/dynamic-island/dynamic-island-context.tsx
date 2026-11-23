import { isDynamicIslandServerVisible } from "@openbot/contracts/ipc";
import { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import type { DynamicIslandText } from "@openbot/team-client/dynamic-island-presentation";
import { currentText } from "@openbot/ui/text";
import { createEffect, flush, onCleanup, onSettled, untrack } from "solid-js";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { dynamicIslandPort } from "./dynamic-island-port";

const PUBLISH_INTERVAL_MS = 100;

const DynamicIsland = createSimpleContext({
  name: "Dynamic Island",
  init: () => {
    const platform = usePlatform();
    const { servers, activeServerId } = useServers();
    const { generalSettings } = useSettings();
    const coordinator = new DynamicIslandCoordinator(islandText);
    const connectedServers = new Set(["local"]);
    let presentationScheduled = false;
    let publishedPresentation: string | undefined;
    let lastPublishedAt = Number.NEGATIVE_INFINITY;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;

    function serverOrder(): string[] {
      const activeId = activeServerId();
      const current = servers();
      const ids = current
        .filter((server) => connectedServers.has(server.id) && (server.kind === "local" || server.state === "online"))
        .map((server) => server.id);
      ids.sort((left, right) => Number(right === activeId) - Number(left === activeId));
      const ordered = ids.length > 0 ? ids : ["local"];
      const muted = new Set(current.filter((server) => server.notificationsMuted).map((server) => server.id));
      const settings = generalSettings();
      const choices = {
        serverVisibility: settings.macBookNotchServers,
        newServersVisible: settings.macBookNotchNewServers,
      };
      return ordered.filter((serverId) => !muted.has(serverId) && isDynamicIslandServerVisible(choices, serverId));
    }

    function islandCanShow(): boolean {
      const info = platform.appInfo();
      return info !== null && info.dynamicIslandUnavailable !== true && generalSettings().macBookNotch;
    }

    function publishPresentation(): void {
      if (platform.landingPreview || platform.chatWindow || presentationScheduled) return;
      if (!untrack(islandCanShow)) return;
      presentationScheduled = true;
      const send = () => {
        presentationScheduled = false;
        publishTimer = undefined;
        lastPublishedAt = performance.now();
        const presentation = coordinator.presentation(serverOrder());
        const serialized = JSON.stringify(presentation);
        if (serialized === publishedPresentation) return;
        publishedPresentation = serialized;
        void dynamicIslandPort()
          .dynamicIsland.publishPresentation(presentation)
          .catch(() => {
            if (publishedPresentation === serialized) publishedPresentation = undefined;
          });
      };
      const wait = lastPublishedAt + PUBLISH_INTERVAL_MS - performance.now();
      if (wait > 0) publishTimer = setTimeout(send, wait);
      else queueMicrotask(send);
    }
    onCleanup(() => clearTimeout(publishTimer));

    createEffect(
      () =>
        servers()
          .map((server) => `${server.id}:${server.state}:${server.notificationsMuted}`)
          .join("\u0000"),
      () => {
        const currentServers = untrack(servers);
        const configuredServerIds = new Set(currentServers.map((server) => server.id));
        for (const serverId of connectedServers) {
          const server = currentServers.find((candidate) => candidate.id === serverId);
          if (!configuredServerIds.has(serverId) || (server?.kind === "remote" && server.state !== "online")) {
            connectedServers.delete(serverId);
          }
        }
        connectedServers.add("local");
        coordinator.retainServers([...configuredServerIds]);
        publishPresentation();
      },
    );

    createEffect(
      () => {
        const settings = generalSettings();
        return `${islandCanShow()}:${settings.macBookNotchNewServers}:${JSON.stringify(settings.macBookNotchServers)}`;
      },
      () => publishPresentation(),
      { defer: true },
    );

    onSettled(() =>
      dynamicIslandPort().agent.onScopedEvent((event) => {
        flush(() => {
          const server = servers().find((candidate) => candidate.id === event.serverId);
          if (server?.kind === "remote" && server.state !== "online") return;
          connectedServers.add(event.serverId);
          coordinator.applyEvent(event, activeServerId());
          publishPresentation();
        });
      }),
    );

    return {
      dynamicIslandCoordinator: coordinator,
      publishDynamicIslandPresentation: publishPresentation,
    };
  },
});

export const DynamicIslandProvider = DynamicIsland.provider;
export const useDynamicIsland = DynamicIsland.use;

function islandText(): DynamicIslandText {
  const { t, errorMessage } = currentText();
  return {
    taskWorking: t("island.task.working"),
    questionHeader: t("island.question.defaultHeader"),
    questionText: t("island.question.defaultText"),
    optionFallback: (number) => t("island.question.optionFallback", { number }),
    takeoverTitle: t("island.takeover.title"),
    takeoverDetail: t("island.takeover.detail"),
    failureTitle: t("island.failure.title"),
    failureDetail: t("island.failure.detail"),
    approvalCommand: t("island.approval.title.command"),
    approvalFileChange: t("island.approval.title.fileChange"),
    approvalPermissions: t("island.approval.title.permissions"),
    errorMessage,
  };
}
