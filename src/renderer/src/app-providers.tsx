import type { ChatWindowTarget } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { type ParentProps, Show } from "solid-js";
import { AnsweredPromptsProvider } from "./answered-prompts";
import { AppBootstrap } from "./app-bootstrap";
import { AuthProvider } from "./features/account/account-context";
import { AgentTasksProvider } from "./features/agent-tasks/agent-tasks-context";
import { AgentThreadsProvider } from "./features/agent-threads/agent-threads-context";
import { AgentActionsProvider } from "./features/agents/agent-actions";
import { AgentEventBridge } from "./features/agents/agent-event-bridge";
import { AgentReadTrackingProvider } from "./features/agents/agent-read-tracking";
import { AgentsProvider } from "./features/agents/agents-context";
import { BrowserTabsProvider } from "./features/browser/browser-context";
import { ChannelsProvider } from "./features/channels/channels-context";
import { readStoredComposerDrafts } from "./features/conversation/composer-draft-storage";
import { ConversationProvider } from "./features/conversation/conversation-context";
import {
  createServerConversationState,
  createStableConversationState,
} from "./features/conversation/conversation-controller";
import { ConversationControllerProvider } from "./features/conversation/conversation-controller-context";
import { DirectMessagesProvider } from "./features/conversation/direct-messages-context";
import { CustomAgentsProvider } from "./features/custom-agents/custom-agents-context";
import { CustomProvidersProvider } from "./features/custom-providers/custom-providers-context";
import { ProviderDetectionProvider } from "./features/custom-providers/provider-detection-context";
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
import { WhatsNewProvider } from "./features/updates/whats-new-context";
import { UsageProvider } from "./features/usage/usage-context";
import { WindowPageProvider } from "./features/window/window-page-context";
import { I18nProvider } from "./i18n-context";
import { LayoutProvider } from "./layout";
import { NavigationProvider } from "./navigation";
import { PlatformProvider, usePlatform } from "./platform";
import { ProvidersProvider } from "./providers";
import { TurnsProvider } from "./turns";
import { UiErrorsProvider } from "./ui-errors";

export interface AppProps {
  landingPreview?: boolean | undefined;
  peopleEnabled?: boolean | undefined;
  chatWindow?: ChatWindowTarget | null | undefined;
}

export function AppProviders(props: ParentProps<AppProps>): JSX.Element {
  const stableConversation = createStableConversationState(
    { onTypingChange: props.chatWindow ? () => undefined : notifyTeamTyping },
    !props.chatWindow,
    readStoredComposerDrafts(),
  );
  return (
    <PlatformProvider
      landingPreview={props.landingPreview}
      peopleEnabled={props.peopleEnabled}
      chatWindow={props.chatWindow}
    >
      <I18nProvider>
        <AuthProvider>
          <SetupProvider>
            <WhatsNewProvider>
              <SettingsProvider>
                <LayoutProvider>
                  <UpdatesProvider>
                    <CustomProvidersProvider>
                      <CustomAgentsProvider>
                        <ProviderDetectionProvider>
                          <ServersProvider>
                            <DynamicIslandProvider>
                              <ServerSettingsProvider>
                                <RemoteDesktopProvider>
                                  <ServerSwitchProvider>
                                    <AnsweredPromptsProvider>
                                      <UiErrorsProvider>
                                        <UsageProvider>
                                          <WindowPageProvider>
                                            <AgentReadTrackingProvider>
                                              <Show when={!props.chatWindow}>
                                                <AppBootstrap />
                                              </Show>
                                              <ServerScopeBoundary stableConversation={stableConversation}>
                                                {props.children}
                                              </ServerScopeBoundary>
                                            </AgentReadTrackingProvider>
                                          </WindowPageProvider>
                                        </UsageProvider>
                                      </UiErrorsProvider>
                                    </AnsweredPromptsProvider>
                                  </ServerSwitchProvider>
                                </RemoteDesktopProvider>
                              </ServerSettingsProvider>
                            </DynamicIslandProvider>
                          </ServersProvider>
                        </ProviderDetectionProvider>
                      </CustomAgentsProvider>
                    </CustomProvidersProvider>
                  </UpdatesProvider>
                </LayoutProvider>
              </SettingsProvider>
            </WhatsNewProvider>
          </SetupProvider>
        </AuthProvider>
      </I18nProvider>
    </PlatformProvider>
  );
}

function ServerScopeBoundary(props: ParentProps<ScopedConversationProps>): JSX.Element {
  const { activeServerId } = useServers();
  return (
    <Show keyed when={activeServerId()}>
      <ScopedProviders stableConversation={props.stableConversation}>{props.children}</ScopedProviders>
    </Show>
  );
}

interface ScopedConversationProps {
  stableConversation: ReturnType<typeof createStableConversationState>;
}

function ScopedProviders(props: ParentProps<ScopedConversationProps>): JSX.Element {
  const platform = usePlatform();
  const conversationController = { ...props.stableConversation, ...createServerConversationState() };
  return (
    <ConversationControllerProvider controller={conversationController}>
      <PresenceProvider>
        <DirectMessagesProvider>
          <AgentsProvider>
            <ChannelsProvider>
              <ProvidersProvider>
                <TurnsProvider>
                  <AgentTasksProvider>
                    <AgentThreadsProvider>
                      <ConversationProvider>
                        <BrowserTabsProvider>
                          <SidebarProvider>
                            <NavigationProvider>
                              <ServerSelectionProvider>
                                <AgentActionsProvider>
                                  <ServerScopeProvider>
                                    <AgentEventBridge />
                                    <Show when={!platform.chatWindow}>
                                      <DynamicIslandBridge />
                                    </Show>
                                    {props.children}
                                  </ServerScopeProvider>
                                </AgentActionsProvider>
                              </ServerSelectionProvider>
                            </NavigationProvider>
                          </SidebarProvider>
                        </BrowserTabsProvider>
                      </ConversationProvider>
                    </AgentThreadsProvider>
                  </AgentTasksProvider>
                </TurnsProvider>
              </ProvidersProvider>
            </ChannelsProvider>
          </AgentsProvider>
        </DirectMessagesProvider>
      </PresenceProvider>
    </ConversationControllerProvider>
  );
}
