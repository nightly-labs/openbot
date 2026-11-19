import type { ServerSummary } from "@openbot/contracts/ipc";
import { Button, ChevronRight, Spinner } from "@openbot/ui";
import { ServerMark } from "@openbot/ui/features/servers/ServerRail";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { ConsentNotice } from "./AnalyticsConsent";

export type FirstRunServer = Pick<ServerSummary, "id" | "name" | "state" | "logoUrl" | "appearance">;

export interface FirstRunExistingServersProps {
  servers: readonly FirstRunServer[];
  opening: string | null;
  disabled: boolean;
  onOpen: (server: FirstRunServer) => void;
  onStartNew: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}

const HERO_SIZE = 5;

export function FirstRunExistingServers(props: FirstRunExistingServersProps) {
  const { t } = useText();
  const detail = (server: FirstRunServer) =>
    server.state === "online" || server.state === "connecting"
      ? t("onboarding.existing.openDetail")
      : t("onboarding.existing.offlineDetail");
  return (
    <section class="first-run-choice" aria-labelledby="onboarding-title">
      <div class="first-run-existing-hero" aria-hidden="true">
        <For each={props.servers.slice(0, HERO_SIZE)}>
          {(server) => (
            <span class="first-run-existing-hero-mark">
              <ServerMark server={server} />
            </span>
          )}
        </For>
      </div>
      <h1 id="onboarding-title" class="first-run-choice-title">
        {t("onboarding.existing.title")}
      </h1>
      <p class="onboarding-description">{t("onboarding.existing.description")}</p>
      <div class="first-run-choice-rows first-run-existing-servers">
        <For each={props.servers}>
          {(server) => (
            <Button
              type="button"
              variant="ghost"
              class="first-run-choice-row"
              disabled={props.disabled || props.opening !== null}
              aria-busy={props.opening === server.id ? "true" : undefined}
              onClick={() => props.onOpen(server)}
            >
              <span class="first-run-existing-mark" aria-hidden="true">
                <ServerMark server={server} />
              </span>
              <span class="first-run-choice-row-text">
                <strong>{t("onboarding.existing.open", { name: server.name })}</strong>
                <span>{detail(server)}</span>
              </span>
              <Show
                when={props.opening === server.id}
                fallback={<ChevronRight class="first-run-choice-row-chevron" aria-hidden="true" />}
              >
                <Spinner size="sm" label={t("onboarding.opening")} />
              </Show>
            </Button>
          )}
        </For>
      </div>
      <div class="first-run-choice-rows first-run-existing-new">
        <Button
          type="button"
          variant="ghost"
          class="first-run-choice-row"
          disabled={props.disabled || props.opening !== null}
          onClick={() => props.onStartNew()}
        >
          <span class="first-run-choice-row-text">
            <strong>{t("onboarding.existing.startNew")}</strong>
            <span>{t("onboarding.existing.startNewDetail")}</span>
          </span>
          <ChevronRight class="first-run-choice-row-chevron" aria-hidden="true" />
        </Button>
      </div>
      <ConsentNotice onOpenTerms={() => props.onOpenTerms()} onOpenPrivacy={() => props.onOpenPrivacy()} />
    </section>
  );
}
