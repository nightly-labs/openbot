import type { JSX } from "@solidjs/web";
import { type ParentProps, Show } from "solid-js";
import { AnsweredPromptsProvider } from "./answered-prompts";
import { AppBootstrap } from "./app-bootstrap";
import { AuthProvider } from "./features/account/account-context";
import { AgentActionsProvider } from "./features/agents/agent-actions";
import { AgentEventBridge } from "./features/agents/agent-event-bridge";
import { AgentReadTrackingProvider } from "./features/agents/agent-read-tracking";
import { AgentsProvider } from "./features/agents/agents-context";
import { BrowserTabsProvider } from "./features/browser/browser-context";
import { ChannelsProvider } from "./features/channels/channels-context";
import { ConversationProvider } from "./features/conversation/conversation-context";
import {
  createServerConversationState,
  createStableConversationState,
} from "./features/conversation/conversation-controller";
import { ConversationControllerProvider } from "./features/conversation/conversation-controller-context";
import { DirectMessagesProvider } from "./features/conversation/direct-messages-context";
import { CustomProvidersProvider } from "./features/custom-providers/custom-providers-context";
import { DynamicIslandBridge } from "./features/dynamic-island/dynamic-island-bridge";
import { DynamicIslandProvider } from "./features/dynamic-island/dynamic-island-context";
import { SetupProvider } from "./features/onboarding/onboarding-context";
import { RemoteDesktopProvider } from "./features/remote-desktop/remote-desktop-context";
import { ServerScopeProvider } from "./features/servers/server-scope";
import { ServerSelectionProvider } from "./features/servers/server-selection";
import { ServerSettingsProvider } from "./features/servers/server-settings";
import { ServerSwitchProvider } from "./features/servers/server-switch";
import { ServersProvider, useServers } from "./features/servers/servers-context";
import { SettingsProvider } from "./features/settings/settings-context";
import { SidebarProvider } from "./features/sidebar/sidebar-context";
import { PresenceProvider } from "./features/team/team-context";
import { notifyTeamTyping } from "./features/team/team-typing";
import { UpdatesProvider } from "./features/updates/updates-context";
import { UsageProvider } from "./features/usage/usage-context";
import { LayoutProvider } from "./layout";
import { NavigationProvider } from "./navigation";
import { PlatformProvider } from "./platform";
import { ProvidersProvider } from "./providers";
import { TurnsProvider } from "./turns";
import { UiErrorsProvider } from "./ui-errors";

/**
 * How the renderer is mounted, as opposed to anything it later loads. Both
 * flags are fixed for the life of a mount: `index.tsx` passes neither, and
 * `preview/OpenBotPlayground.tsx` passes `landingPreview`.
 */
export interface AppProps {
  landingPreview?: boolean;
  peopleEnabled?: boolean;
}

/**
 * The composition root for renderer state: one nesting of domain providers,
 * outermost first, that every consumer below reads through its own `use*()`.
 *
 * The order of this file *is* the dependency graph - a domain may read one it is
 * nested inside and never one nested under it. Three rules keep it usable:
 *
 * - **It must never import `AppView.tsx`, and no gate may depend on the view
 *   tree.** The harnesses in `App.test.tsx` and `App.read-state.test.tsx` mount
 *   this with no view at all, which is why the largest test file asserts data
 *   instead of DOM. A gate waiting on something rendered would hang them both.
 * - **Nothing that runs inside it may import `App.tsx` as a value.** `App.tsx`
 *   imports this module, so a value edge back is a cycle, and `noImportCycles`
 *   is an error.
 * - **Where a provider sits decides how long its state lives.** Everything above
 *   `ServerScopeBoundary` outlives a server switch; everything below it is
 *   discarded and rebuilt by the switch. Nothing else does per-server teardown,
 *   so a signal placed on the wrong side of that line is a bug that no setter
 *   list can fix.
 *
 * **No provider here is gated.** The only child of this nesting is the whole
 * application, so a `ready` predicate withholds not just the domain's consumers
 * but the loading screen `AppAccessGate` renders and the bootstrap loads that
 * run in parallel with the gated one - trading a startup that fans out for one
 * that runs in series, and a placeholder for a blank window. Gates become
 * available once the view is split along these same boundaries and each one can
 * sit above the domain it waits on. Until then the loaded-state checks stay
 * where they already are, in the view.
 */
export function AppProviders(props: ParentProps<AppProps>): JSX.Element {
  const stableConversation = createStableConversationState({ onTypingChange: notifyTeamTyping });
  return (
    <PlatformProvider landingPreview={props.landingPreview} peopleEnabled={props.peopleEnabled}>
      <AuthProvider>
        <SetupProvider>
          <SettingsProvider>
            <LayoutProvider>
              <UpdatesProvider>
                <CustomProvidersProvider>
                  <ServersProvider>
                    <DynamicIslandProvider>
                      <ServerSettingsProvider>
                        <RemoteDesktopProvider>
                          <ServerSwitchProvider>
                            <AnsweredPromptsProvider>
                              <UiErrorsProvider>
                                <UsageProvider>
                                  <AgentReadTrackingProvider>
                                    <AppBootstrap />
                                    <ServerScopeBoundary stableConversation={stableConversation}>
                                      {props.children}
                                    </ServerScopeBoundary>
                                  </AgentReadTrackingProvider>
                                </UsageProvider>
                              </UiErrorsProvider>
                            </AnsweredPromptsProvider>
                          </ServerSwitchProvider>
                        </RemoteDesktopProvider>
                      </ServerSettingsProvider>
                    </DynamicIslandProvider>
                  </ServersProvider>
                </CustomProvidersProvider>
              </UpdatesProvider>
            </LayoutProvider>
          </SettingsProvider>
        </SetupProvider>
      </AuthProvider>
    </PlatformProvider>
  );
}

/** Server switches dispose scoped state; reconnects reload it without clearing cached data. */
function ServerScopeBoundary(props: ParentProps<ScopedConversationProps>): JSX.Element {
  const { activeServerId } = useServers();
  return (
    <Show keyed when={activeServerId()}>
      <ScopedProviders stableConversation={props.stableConversation}>{props.children}</ScopedProviders>
    </Show>
  );
}

/**
 * The stable half of the conversation controller, threaded down to the scope that
 * completes it. It is a prop rather than a context because the only reader is one
 * component two levels below, and a context for it would be a second way to reach
 * the same object.
 */
interface ScopedConversationProps {
  stableConversation: ReturnType<typeof createStableConversationState>;
}

/** Everything whose lifetime is one server. See `server-scope.tsx`. */
function ScopedProviders(props: ParentProps<ScopedConversationProps>): JSX.Element {
  const conversationController = { ...props.stableConversation, ...createServerConversationState() };
  return (
    <ConversationControllerProvider controller={conversationController}>
      <PresenceProvider>
        <DirectMessagesProvider>
          <AgentsProvider>
            <ChannelsProvider>
              <ProvidersProvider>
                <TurnsProvider>
                  <ConversationProvider>
                    <BrowserTabsProvider>
                      <SidebarProvider>
                        <NavigationProvider>
                          <ServerSelectionProvider>
                            <AgentActionsProvider>
                              <ServerScopeProvider>
                                <AgentEventBridge />
                                <DynamicIslandBridge />
                                {props.children}
                              </ServerScopeProvider>
                            </AgentActionsProvider>
                          </ServerSelectionProvider>
                        </NavigationProvider>
                      </SidebarProvider>
                    </BrowserTabsProvider>
                  </ConversationProvider>
                </TurnsProvider>
              </ProvidersProvider>
            </ChannelsProvider>
          </AgentsProvider>
        </DirectMessagesProvider>
      </PresenceProvider>
    </ConversationControllerProvider>
  );
}
