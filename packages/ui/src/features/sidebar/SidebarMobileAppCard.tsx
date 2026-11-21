import { type MobilePlatformLogoVariant, PlatformLogo } from "@openbot/brand";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { Button, IconButton, X } from "@openbot/ui";
import { createSignal, For, onSettled } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

type CrewAgent = Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl">;

const CREW_SIZE = 5;
const LEAD_INDEX = Math.floor(CREW_SIZE / 2);
const CENTER_FIRST_PLACES = [2, 1, 3, 0, 4];

const STAND_IN_CREW: readonly CrewAgent[] = (
  [
    { seed: "research", hue: 215 },
    { seed: "inbox", hue: 30 },
    { seed: "planner", hue: 150 },
    { seed: "design", hue: 320 },
    { seed: "writer", hue: 280 },
  ] satisfies { seed: string; hue: AvatarHue }[]
).map((member) => ({ avatarSeed: member.seed, avatarHue: member.hue, avatarColor: null, avatarUrl: null }));

const PLATFORMS: readonly {
  platform: MobilePlatformLogoVariant;
  label: "sidebar.mobileApp.iphone" | "sidebar.mobileApp.android";
}[] = [
  { platform: "ios", label: "sidebar.mobileApp.iphone" },
  { platform: "android", label: "sidebar.mobileApp.android" },
];

function crewMembers(agents: readonly CrewAgent[]): CrewAgent[] {
  const crew = [...STAND_IN_CREW];
  agents.slice(0, CREW_SIZE).forEach((agent, order) => {
    crew[CENTER_FIRST_PLACES[order] ?? order] = agent;
  });
  return crew;
}

export function SidebarMobileAppCard(props: {
  agents: readonly CrewAgent[];
  onInstall: (platform: MobilePlatformLogoVariant) => void;
  onDismiss: () => void;
}) {
  const { t } = useText();
  const [pointerInSidebar, setPointerInSidebar] = createSignal(false);
  let section: HTMLElement | undefined;
  onSettled(() => {
    const area = section?.closest<HTMLElement>(".sidebar") ?? section;
    if (!area) return;
    const enter = () => setPointerInSidebar(true);
    const leave = () => setPointerInSidebar(false);
    setPointerInSidebar(area.matches(":hover"));
    area.addEventListener("pointerenter", enter);
    area.addEventListener("pointerleave", leave);
    return () => {
      area.removeEventListener("pointerenter", enter);
      area.removeEventListener("pointerleave", leave);
    };
  });
  return (
    <section
      ref={section}
      class="sidebar-mobile-app sidebar-mobile-app-crew"
      aria-labelledby="sidebar-mobile-app-title"
    >
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
              <AgentAvatar
                agent={member}
                motion="idle"
                followPointer={pointerInSidebar()}
                class="sidebar-mobile-app-crew-avatar"
              />
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
