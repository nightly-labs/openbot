import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Switch,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show } from "solid-js";
import { useRemoteChatContent } from "./remote-chat-content";

export function ServerRemoteChatContentSetting(props: {
  serverId: string;
  disabled: boolean;
  run: (key: string, action: () => Promise<void>) => Promise<boolean>;
}) {
  const { t } = useText();
  const remoteChatContent = useRemoteChatContent();
  const [loadedFor, setLoadedFor] = createSignal<string | null>(null);

  createEffect(
    () => props.serverId,
    (serverId) => {
      setLoadedFor(null);
      void remoteChatContent.load(serverId).then(() => setLoadedFor(serverId));
    },
  );

  return (
    <SettingsSection title={t("server.settings.privacyTitle")}>
      <ItemGroup class="settings-modal-card">
        <Item>
          <ItemContent>
            <ItemTitle id="server-settings-remote-chat-content-label">
              {t("server.settings.remoteChatContent")}
            </ItemTitle>
            <ItemDescription>{t("server.settings.remoteChatContentDescription")}</ItemDescription>
          </ItemContent>
          <Show when={loadedFor() === props.serverId}>
            <ItemActions>
              <Switch
                checked={remoteChatContent.enabled(props.serverId)}
                disabled={props.disabled}
                onChange={(enabled) => {
                  const serverId = props.serverId;
                  void props.run("remoteChatContent", async () => {
                    await remoteChatContent.set(enabled, serverId);
                  });
                }}
                aria-labelledby="server-settings-remote-chat-content-label"
              />
            </ItemActions>
          </Show>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}
