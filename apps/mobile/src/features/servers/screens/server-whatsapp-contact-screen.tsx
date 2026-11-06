import { MESSAGING_LIMITS, parseWhatsAppPhoneNumber } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useConnectorAction, useServerConnectors } from "@/features/servers/model/use-server-connectors";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { useText } from "@/shared/lib/text";

/**
 * Marketplace › Apps › WhatsApp › Add contact: a person who can give work through one
 * linked number. The host keeps the number in digits; the name is optional.
 */
export function ServerWhatsAppContactScreen() {
  const { t, errorMessage } = useText();
  const { serverId, workspaceId } = useLocalSearchParams<{ serverId: string; workspaceId: string }>();
  const { server, whatsappAvailable, whatsapp } = useServerConnectors(serverId, null);
  const { addWhatsAppSender } = useMobileWorkspaceActions();
  const action = useConnectorAction(whatsapp.refetch);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  if (!server || !whatsappAvailable || !workspaceId)
    return (
      <SettingsContent>
        <SettingsNote>{t(server ? "mobile.server.connectors.unavailable" : "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const add = () => {
    const id = parseWhatsAppPhoneNumber(phone);
    if (!id) {
      setInvalid(true);
      return;
    }
    void action
      .perform(async () => {
        await addWhatsAppSender({ workspaceId, sender: { kind: "contact", id, name: name.trim() } }, server.id);
      })
      .then((done) => {
        if (done && router.canGoBack()) router.back();
      });
  };
  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={phone.trim().length > 0}
        canSave
        pending={action.busy}
        label={t("mobile.server.connectors.whatsapp.add")}
        onSave={add}
      />
      <SettingsNote>{t("mobile.server.connectors.whatsapp.contactDescription")}</SettingsNote>
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
          {errorMessage(
            action.error,
            t("mobile.server.connectors.actionFailed", { name: t("mobile.server.connectors.whatsapp.title") }),
          )}
        </Typography.Paragraph>
      ) : null}
      <SheetFormField
        label={t("mobile.server.connectors.whatsapp.phoneLabel")}
        inputMode="tel"
        autoCorrect={false}
        autoFocus
        isRequired
        editable={!action.busy}
        value={phone}
        hint={t(
          invalid
            ? "mobile.server.connectors.whatsapp.phoneInvalid"
            : "mobile.server.connectors.whatsapp.phoneDescription",
        )}
        onChangeText={(value) => {
          setPhone(value);
          setInvalid(false);
          action.reset();
        }}
      />
      <SheetFormField
        label={t("mobile.server.connectors.whatsapp.contactName")}
        autoCorrect={false}
        maxLength={MESSAGING_LIMITS.name}
        editable={!action.busy}
        value={name}
        hint={t("mobile.server.connectors.whatsapp.contactNameDescription")}
        returnKeyType="done"
        onChangeText={setName}
        onSubmitEditing={() => {
          if (phone.trim()) add();
        }}
      />
    </SettingsContent>
  );
}
