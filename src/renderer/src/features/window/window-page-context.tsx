import { type CreditsMenu, createCreditsSummary } from "@openbot/ui/features/credits/credits-store";
import type { SettingsPageBack, SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { appPort } from "../../app-port";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useUsage } from "../usage/usage-context";

export type WindowPage =
  | "agents"
  | "tasks"
  | "schedule"
  | "workflows"
  | "usage"
  | "library"
  | "crm"
  | "marketplace"
  | "settings"
  | "server-settings"
  | "credits"
  | "pricing";

export type WindowPageKind = "agents" | "settings" | "titled";

export function windowPageKind(page: WindowPage): WindowPageKind {
  if (page === "settings" || page === "server-settings") return "settings";
  return page === "agents" || page === "tasks" ? "agents" : "titled";
}

export interface PricingPagePlacement {
  mount: () => HTMLElement | undefined;
  open: (leave: () => void) => void;
  close: () => void;
}

export type SettingsKind = "personal" | "server";

const context = createSimpleContext({
  name: "WindowPageProvider",
  init: () => {
    const settings = useSettings();
    const serverSettings = useServerSettings();
    const usage = useUsage();
    const { activeServerId } = useServers();
    const { signedInAccount } = useAuth();
    const credits = createCreditsSummary(
      () => appPort().credits,
      () => signedInAccount()?.id ?? null,
    );
    const [settingsMounts, setSettingsMounts] = createSignal<SettingsPagePlacement | undefined>();
    const [serverSettingsQuery, setServerSettingsQuery] = createSignal("");
    const [openFirstServerSectionRequest, setOpenFirstServerSectionRequest] = createSignal(0);

    const [pricingLeave, setPricingLeave] = createSignal<(() => void) | null>(null);
    const [pricingMount, setPricingMount] = createSignal<HTMLElement | undefined>();
    function leavePricing() {
      const leave = untrack(pricingLeave);
      if (!leave) return;
      setPricingLeave(null);
      setPricingMount(undefined);
      leave();
    }
    const [creditsOpen, setCreditsOpen] = createSignal<{ serverId: string | null } | null>(null);
    function closeCredits() {
      if (untrack(creditsOpen)) setCreditsOpen(null);
    }
    const pricing: PricingPagePlacement = {
      mount: pricingMount,
      open: (leave) => {
        closeCredits();
        setPricingLeave(() => leave);
      },
      close: () => {
        setPricingLeave(null);
        setPricingMount(undefined);
      },
    };

    const basePage = createMemo<WindowPage>(() => {
      if (serverSettings.serverSettingsOpen()) return "server-settings";
      if (settings.appSettingsOpen()) return "settings";
      if (settings.skillsMarketplaceOpen()) return "marketplace";
      return usage.state.serverId ? usage.state.view : "agents";
    });
    const page = createMemo<WindowPage>(() => {
      if (pricingLeave()) return "pricing";
      return creditsOpen() ? "credits" : basePage();
    });

    createEffect(basePage, (_next, previous) => {
      if (previous !== undefined) leavePricing();
    });

    createEffect(settings.appSettingsOpenRequest, (request, previous) => {
      if (previous === undefined || request === previous) return;
      leavePricing();
      closeCredits();
      usage.dismissUsage();
      if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
    });

    createEffect(serverSettings.serverSettingsOpenRequest, (request, previous) => {
      if (previous === undefined || request === previous) return;
      leavePricing();
      closeCredits();
      usage.dismissUsage();
      if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
    });

    createEffect(
      () => usage.state.serverId,
      (serverId) => {
        if (!serverId) return;
        closeCredits();
        if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
        if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
        if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      },
    );

    createEffect(settings.skillsMarketplaceOpen, (open) => {
      if (!open) return;
      closeCredits();
      usage.dismissUsage();
      if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
      if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
    });

    createEffect(activeServerId, (serverId, previous) => {
      if (previous === undefined || serverId === previous || !serverId) return;
      if (untrack(serverSettings.serverSettingsOpen)) untrack(() => serverSettings.openServerSettings(serverId, null));
    });

    const [personalBack, setPersonalBack] = createSignal<SettingsPageBack | null>(null);
    const [serverBack, setServerBack] = createSignal<SettingsPageBack | null>(null);
    const placementFor = (kind: SettingsKind) =>
      createMemo<SettingsPagePlacement | undefined>(() => {
        const mounts = settingsMounts();
        if (!mounts || page() !== (kind === "personal" ? "settings" : "server-settings")) return undefined;
        return { ...mounts, onBack: (back) => (kind === "personal" ? setPersonalBack(back) : setServerBack(back)) };
      });
    const placements = { personal: placementFor("personal"), server: placementFor("server") };

    function settingsPlacement(kind: SettingsKind): SettingsPagePlacement | undefined {
      return placements[kind]();
    }

    function pageBack(): SettingsPageBack | null {
      if (page() === "settings") return personalBack();
      return page() === "server-settings" ? serverBack() : null;
    }

    function openCredits(serverId: string | null) {
      leavePricing();
      usage.dismissUsage();
      if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
      if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
      if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      setCreditsOpen({ serverId });
    }

    return {
      page,
      conversationCovered: () => page() !== "agents",
      setSettingsMounts,
      settingsPlacement,
      serverSettingsQuery,
      setServerSettingsQuery: (query: string) => setServerSettingsQuery(query),
      openFirstServerSectionRequest,
      openFirstServerSection: () => setOpenFirstServerSectionRequest((request) => request + 1),
      pageBack,
      pricing,
      setPricingMount: (element: HTMLElement | undefined) => setPricingMount(element),
      leavePricing,
      creditsServerId: () => creditsOpen()?.serverId ?? null,
      creditsAvailable: credits.available,
      creditsMenu: (): CreditsMenu => ({
        state: credits.state(),
        onOpen: openCredits,
        onRefresh: credits.refresh,
      }),
      openCredits,
      closeCredits,
      showAgents() {
        leavePricing();
        closeCredits();
        settings.setAppSettingsOpen(false);
        serverSettings.setServerSettingsOpen(false);
        settings.setSkillsMarketplaceOpen(false);
        usage.dismissUsage();
      },
      openTasks(source: HTMLElement | null) {
        leavePricing();
        const serverId = activeServerId();
        if (serverId) usage.openTasks(serverId, source);
      },
      openSchedule(source: HTMLElement | null) {
        leavePricing();
        const serverId = activeServerId();
        if (serverId) usage.openSchedule(serverId, source);
      },
      openWorkflows(source: HTMLElement | null, workflow?: { serverId: string; workflowId: string }) {
        leavePricing();
        const serverId = workflow?.serverId ?? activeServerId();
        if (serverId) usage.openWorkflows(serverId, source, workflow?.workflowId);
      },
      openUsage(source: HTMLElement | null) {
        leavePricing();
        const serverId = activeServerId();
        if (serverId) usage.openUsage(serverId, source);
      },
      openLibrary(source: HTMLElement | null) {
        leavePricing();
        const serverId = activeServerId();
        if (serverId) usage.openLibrary(serverId, source);
      },
      openCrm(source: HTMLElement | null, connectors = false) {
        leavePricing();
        const serverId = activeServerId();
        if (serverId) usage.openCrm(serverId, source, connectors);
      },
      openSettings(source: HTMLElement | null) {
        leavePricing();
        settings.openAppSettings(source);
      },
    };
  },
});

export const WindowPageProvider = context.provider;
export const useWindowPage = context.use;
