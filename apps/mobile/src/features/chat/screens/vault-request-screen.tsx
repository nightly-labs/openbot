import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { vaultRequestHandoff } from "@/features/chat/model/vault-request";
import { useServerVault } from "@/features/servers/model/use-server-vault";
import { VaultItemForm } from "@/features/servers/screens/server-vault-item-screen";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { SheetCloseAction } from "@/shared/components/sheet-close-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function VaultRequestScreen() {
  const { t } = useText();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const [handoff] = useState(() => vaultRequestHandoff(requestId));
  const vault = useServerVault(handoff?.serverId ?? "");
  const close = () => {
    void haptics.impact("soft");
    router.back();
  };
  return (
    <>
      <SheetCloseAction onPress={close} />
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
