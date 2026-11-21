import { type MobilePlatformLogoVariant, PlatformLogo } from "@openbot/brand";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { Button, IconButton, X } from "@openbot/ui";
import { For } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

type CrewAgent = Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl">;

const CREW_SIZE = 5;
const LEAD_INDEX = Math.floor(CREW_SIZE / 2);

const STAND_IN_CREW: readonly { seed: string; hue: AvatarHue }[] = [
  { seed: "research", hue: 215 },
  { seed: "inbox", hue: 30 },
  { seed: "planner", hue: 150 },
  { seed: "design", hue: 320 },
  { seed: "writer", hue: 280 },
];

const PLATFORMS: readonly {
  platform: MobilePlatformLogoVariant;
  label: "sidebar.mobileApp.iphone" | "sidebar.mobileApp.android";
}[] = [
  { platform: "ios", label: "sidebar.mobileApp.iphone" },
  { platform: "android", label: "sidebar.mobileApp.android" },
];

function crewMembers(agents: readonly CrewAgent[]): CrewAgent[] {
  const own = agents.slice(0, CREW_SIZE);
  const standIns = STAND_IN_CREW.slice(own.length).map((member) => ({
    avatarSeed: member.seed,
    avatarHue: member.hue,
    avatarColor: null,
    avatarUrl: null,
  }));
  return [...own, ...standIns];
}

export function SidebarMobileAppCard(props: {
  agents: readonly CrewAgent[];
  onInstall: (platform: MobilePlatformLogoVariant) => void;
  onDismiss: () => void;
}) {
  const { t } = useText();
  return (
    <section class="sidebar-mobile-app sidebar-mobile-app-crew" aria-labelledby="sidebar-mobile-app-title">
      <IconButton
        class="sidebar-mobile-app-dismiss"
        size="icon-xs"
        variant="ghost"
        label={t("sidebar.mobileApp.dismiss")}
        data-cuelume-tap="close"
        onClick={() => props.onDismiss()}
      >
        <X aria-hidden="true" />
      </IconButton>
      <div class="sidebar-mobile-app-crew-stage" aria-hidden="true">
        <For each={crewMembers(props.agents)}>
          {(member, index) => (
            <span
              class="sidebar-mobile-app-crew-member"
              data-lead={index() === LEAD_INDEX ? "" : undefined}
              style={{ "--sidebar-crew-index": String(index()) }}
            >
              <AgentAvatar agent={member} motion="idle" followPointer class="sidebar-mobile-app-crew-avatar" />
            </span>
          )}
        </For>
      </div>
      <strong id="sidebar-mobile-app-title" class="sidebar-mobile-app-crew-title">
        {t("sidebar.mobileApp.pocketTitle")}
      </strong>
      <div class="sidebar-mobile-app-platforms">
        <For each={PLATFORMS}>
          {(entry) => (
            <Button type="button" size="sm" onClick={() => props.onInstall(entry.platform)}>
              <PlatformLogo platform={entry.platform} class="sidebar-mobile-app-platform-logo" />
              {t(entry.label)}
            </Button>
          )}
        </For>
      </div>
    </section>
  );
}
