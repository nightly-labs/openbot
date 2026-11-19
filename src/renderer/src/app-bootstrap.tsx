import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import { createEffect, flush, onSettled } from "solid-js";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useServers } from "./features/servers/servers-context";
import { useSettings } from "./features/settings/settings-context";

export function AppBootstrap() {
  const { centralAuth } = useAuth();
  const { setupState, pendingInviteUrl, setPendingInviteUrl } = useSetup();
  const { setJoinServerOpen } = useServers();
  const { setPendingAgentTemplateId, setPendingPluginSlug, setPendingMarketplaceListing, setSkillsMarketplaceOpen } =
    useSettings();

  onSettled(() => {
    const receiveInvite = (inviteUrl: string) => {
      flush(() => {
        setPendingInviteUrl(inviteUrl);
        if (setupState()?.completed === true && centralAuth().status === "signed_in") setJoinServerOpen(true);
      });
    };
    const unsubscribeInvite = appPort().servers.onInvite((inviteUrl) => {
      receiveInvite(inviteUrl);
    });
    const receivePluginSlug = (slug: string) => {
      flush(() => {
        setPendingPluginSlug(slug);
        setSkillsMarketplaceOpen(true);
      });
    };
    const unsubscribePlugin = appPort().plugins.onOpenListing((slug) => {
      receivePluginSlug(slug);
    });
    const receiveMarketplaceListing = (link: MarketplaceListingLink) => {
      flush(() => {
        setPendingMarketplaceListing(link);
        setSkillsMarketplaceOpen(true);
      });
    };
    const unsubscribeMarketplace = appPort().marketplace.onOpenListing((link) => {
      receiveMarketplaceListing(link);
    });
    const receiveAgentTemplate = (id: string) => {
      flush(() => setPendingAgentTemplateId(id));
    };
    const unsubscribeAgentTemplate = appPort().agentTemplates.onOpenLink((id) => {
      receiveAgentTemplate(id);
    });
    void appPort()
      .servers.takePendingInvite()
      .then((inviteUrl) => inviteUrl && receiveInvite(inviteUrl))
      .catch(() => undefined);
    void appPort()
      .plugins.takePendingListing()
      .then((slug) => slug && receivePluginSlug(slug))
      .catch(() => undefined);
    void appPort()
      .marketplace.takePendingListing()
      .then((link) => link && receiveMarketplaceListing(link))
      .catch(() => undefined);
    void appPort()
      .agentTemplates.takePendingLink()
      .then((id) => id && receiveAgentTemplate(id))
      .catch(() => undefined);
    return () => {
      unsubscribeInvite();
      unsubscribePlugin();
      unsubscribeMarketplace();
      unsubscribeAgentTemplate();
    };
  });

  createEffect(
    () => ({
      inviteUrl: pendingInviteUrl(),
      setupCompleted: setupState()?.completed === true,
      signedIn: centralAuth().status === "signed_in",
    }),
    ({ inviteUrl, setupCompleted, signedIn }) => {
      if (inviteUrl && setupCompleted && signedIn) {
        setJoinServerOpen(true);
      }
    },
  );

  return null;
}
