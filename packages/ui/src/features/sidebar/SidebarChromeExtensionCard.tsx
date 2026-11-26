import { PlatformLogo } from "@openbot/brand";
import { Button, IconButton, X } from "@openbot/ui";
import { For } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

type PanelAgent = Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl">;

const STAND_IN_AGENT: PanelAgent = { avatarSeed: "research", avatarHue: 215, avatarColor: null, avatarUrl: null };
const THREE = [0, 1, 2];

export function SidebarChromeExtensionCard(props: {
  agents: readonly PanelAgent[];
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const { t } = useText();
  return (
    <section
      class="sidebar-mobile-app sidebar-mobile-app-crew sidebar-chrome-card"
      aria-labelledby="sidebar-chrome-card-title"
    >
      <IconButton
        class="sidebar-mobile-app-dismiss"
        size="icon-xs"
        variant="ghost"
        label={t("sidebar.chromeExtension.dismiss")}
        data-cuelume-tap="close"
        onClick={() => props.onDismiss()}
      >
        <X aria-hidden="true" />
      </IconButton>
      <div class="sidebar-chrome-stage" aria-hidden="true">
        <div class="sidebar-chrome-window">
          <div class="sidebar-chrome-bar">
            <span class="sidebar-chrome-lights">
              <For each={THREE}>{() => <span class="sidebar-chrome-light" />}</For>
            </span>
            <span class="sidebar-chrome-address">
              <PlatformLogo platform="chrome" class="sidebar-chrome-address-logo" />
            </span>
          </div>
          <div class="sidebar-chrome-viewport">
            <div class="sidebar-chrome-page">
              <span class="sidebar-chrome-hero" />
              <For each={THREE}>{(index) => <span class="sidebar-chrome-line" data-index={index} />}</For>
            </div>
            <div class="sidebar-chrome-panel">
              <span class="sidebar-chrome-message" />
              <span class="sidebar-chrome-typing">
                <For each={THREE}>{(index) => <span class="sidebar-chrome-typing-dot" data-index={index} />}</For>
              </span>
            </div>
          </div>
        </div>
        <span class="sidebar-chrome-agent">
          <AgentAvatar agent={props.agents[0] ?? STAND_IN_AGENT} motion="idle" class="sidebar-chrome-avatar" />
        </span>
      </div>
      <strong id="sidebar-chrome-card-title" class="sidebar-mobile-app-crew-title">
        {t("sidebar.chromeExtension.title")}
      </strong>
      <div class="sidebar-mobile-app-platforms sidebar-chrome-actions">
        <Button type="button" size="sm" onClick={() => props.onAdd()}>
          <PlatformLogo platform="chrome" class="sidebar-mobile-app-platform-logo" />
          {t("sidebar.chromeExtension.add")}
        </Button>
      </div>
    </section>
  );
}
