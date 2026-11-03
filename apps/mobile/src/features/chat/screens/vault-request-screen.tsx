import { router, Stack, useLocalSearchParams } from "expo-router";
import X from "lucide-react-native/icons/x";
import { useState } from "react";
import { vaultRequestHandoff } from "@/features/chat/model/vault-request";
import { useServerVault } from "@/features/servers/model/use-server-vault";
import { VaultItemForm } from "@/features/servers/screens/server-vault-item-screen";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/**
 * The Vault item form of an agent's `request_vault_item` card. The user types the secrets here; the
 * host saves the item and gives the agent its name only.
 */
export function VaultRequestScreen() {
  const { t } = useText();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  // The card can leave the screen while the sheet is open; the form keeps the request it opened with.
  const [handoff] = useState(() => vaultRequestHandoff(requestId));
  const vault = useServerVault(handoff?.serverId ?? "");
  const close = () => {
    void haptics.impact("soft");
    router.back();
  };
  return (
    <>
      {isAndroid ? (
        <AndroidHeaderButton placement="left" icon={X} accessibilityLabel={t("common.close")} onPress={close} />
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel={t("common.close")} onPress={close}>
            {t("common.close")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      {handoff && vault.server && vault.canManage ? (
        <VaultItemForm
          serverId={handoff.serverId}
          host={vault.server.name}
          kind={handoff.kind}
          saved={undefined}
          contacts={[]}
          vault={vault}
          request={{ title: handoff.title, prefill: handoff.prefill, save: handoff.save }}
        />
      ) : (
        <SettingsContent>
          <SettingsNote>
            {!handoff
              ? t("mobile.chat.vaultRequest.gone")
              : !vault.server
                ? t("mobile.server.unavailable")
                : t("mobile.chat.vaultRequest.notAllowed")}
          </SettingsNote>
        </SettingsContent>
      )}
    </>
  );
}
