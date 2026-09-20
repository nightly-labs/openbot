import { createEffect, flush, onSettled } from "solid-js";
import { toast } from "./components/ui";
import { useAuth } from "./features/account/account-context";
import { useSetup } from "./features/onboarding/onboarding-context";
import { takeMcpConfigDoorNotice } from "./features/servers/mcp-servers";
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
 * marketplace on one listing, and installs nothing.
 *
 * The MCP notice below belongs here for the same reason: the MCP list is
 * machine-scoped, the notice is owed once per computer and not once per
 * workspace, and it has to reach a user who never opens the MCP panel.
 */
export function AppBootstrap() {
  const { centralAuth } = useAuth();
  const { setupState, pendingInviteUrl, setPendingInviteUrl } = useSetup();
  const { setJoinServerOpen } = useServers();
  const { setPendingPluginSlug, setSkillsMarketplaceOpen } = useSettings();

  onSettled(() => {
    const receiveInvite = (inviteUrl: string) => {
      flush(() => {
        setPendingInviteUrl(inviteUrl);
        if (setupState()?.completed === true && centralAuth().status === "signed_in") setJoinServerOpen(true);
      });
    };
    const unsubscribeInvite = window.openbot.servers.onInvite((inviteUrl) => {
      receiveInvite(inviteUrl);
    });
    const receivePluginSlug = (slug: string) => {
      flush(() => {
        setPendingPluginSlug(slug);
        setSkillsMarketplaceOpen(true);
      });
    };
    const unsubscribePlugin = window.openbot.plugins.onOpenListing((slug) => {
      receivePluginSlug(slug);
    });
    // Both subscriptions are in place before either link is asked for, because the first of these
    // two requests is what tells main that a window is listening.
    void window.openbot.servers
      .takePendingInvite()
      .then((inviteUrl) => inviteUrl && receiveInvite(inviteUrl))
      .catch(() => undefined);
    void window.openbot.plugins
      .takePendingListing()
      .then((slug) => slug && receivePluginSlug(slug))
      .catch(() => undefined);
    return () => {
      unsubscribeInvite();
      unsubscribePlugin();
    };
  });

  /*
   * Said once, because the release it describes takes servers away: Claude is now started with
   * `strictMcpConfig` and Codex with the names in its own file turned off, so a server the user
   * declared outside OpenBot stops reaching their agents. There is no opt-out to point at, so the
   * notice names the files and says what to do instead.
   */
  createEffect(
    () => setupState(),
    (setup) => {
      if (!setup) return;
      const notice = takeMcpConfigDoorNotice(setup.completed);
      if (notice) toast.warning(notice.title, { description: notice.description });
    },
  );

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
