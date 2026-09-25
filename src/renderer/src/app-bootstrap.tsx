import { createEffect, flush, onSettled } from "solid-js";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useServers } from "./features/servers/servers-context";
import { useSettings } from "./features/settings/settings-context";

/**
 * The deep links, and nothing else.
 *
 * This used to hold the first per-server load and the two window listeners as
 * well. Both moved into `server-scope.tsx` when the per-server state became a
 * keyed subtree: the load because first mount and server switch are now the same
 * mount, and the listeners because both read scoped state.
 *
 * What is left genuinely belongs above that boundary. An invite can arrive
 * before any server exists, has to survive the switch it causes, and spans
 * setup, auth and servers - so it is registered once, for the life of the
 * window.
 *
 * A plugin link is the same problem with a shorter answer: it opens the
 * marketplace on one listing, and installs nothing. An agent link is the same:
 * it opens the install dialog on one template, and installs nothing by itself.
 *
 * The MCP notice below belongs here for the same reason: the MCP list is
 * machine-scoped, the notice is owed once per computer and not once per
 * workspace, and it has to reach a user who never opens the MCP panel.
 */
export function AppBootstrap() {
  const { centralAuth } = useAuth();
  const { setupState, pendingInviteUrl, setPendingInviteUrl } = useSetup();
  const { setJoinServerOpen } = useServers();
  const { setPendingAgentTemplateId, setPendingPluginSlug, setSkillsMarketplaceOpen } = useSettings();

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
    const receiveAgentTemplate = (id: string) => {
      flush(() => setPendingAgentTemplateId(id));
    };
    const unsubscribeAgentTemplate = appPort().agentTemplates.onOpenLink((id) => {
      receiveAgentTemplate(id);
    });
    // Every subscription is in place before any link is asked for, because the first of these
    // requests is what tells main that a window is listening.
    void appPort()
      .servers.takePendingInvite()
      .then((inviteUrl) => inviteUrl && receiveInvite(inviteUrl))
      .catch(() => undefined);
    void appPort()
      .plugins.takePendingListing()
      .then((slug) => slug && receivePluginSlug(slug))
      .catch(() => undefined);
    void appPort()
      .agentTemplates.takePendingLink()
      .then((id) => id && receiveAgentTemplate(id))
      .catch(() => undefined);
    return () => {
      unsubscribeInvite();
      unsubscribePlugin();
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
