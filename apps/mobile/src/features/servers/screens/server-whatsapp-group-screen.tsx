import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import {
  useConnectorAction,
  useServerConnectors,
  useWhatsAppGroups,
} from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

/**
 * Marketplace › Apps › WhatsApp › Add group: one group of a linked number whose people can
 * give work. The host reads the groups of the number from WhatsApp when the page opens.
 */
export function ServerWhatsAppGroupScreen() {
  const { t, errorMessage } = useText();
  const { serverId, workspaceId } = useLocalSearchParams<{ serverId: string; workspaceId: string }>();
  const { server, whatsappAvailable, whatsapp } = useServerConnectors(serverId, null);
  const groups = useWhatsAppGroups(serverId, workspaceId ?? "", whatsappAvailable && Boolean(workspaceId));
  const { addWhatsAppSender } = useMobileWorkspaceActions();
  const action = useConnectorAction(whatsapp.refetch);
  const [search, setSearch] = useState("");
  if (!server || !whatsappAvailable || !workspaceId)
    return (
      <SettingsContent>
        <SettingsNote>{t(server ? "mobile.server.connectors.unavailable" : "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const list = groups.data?.groups;
  if (!list)
    return (
      <SettingsContent>
        <SettingsNote>
          {groups.isError
            ? errorMessage(groups.error, t("mobile.server.connectors.whatsapp.groupsLoadFailed"))
            : t("mobile.server.connectors.whatsapp.groupsLoading")}
        </SettingsNote>
        {groups.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} onPress={() => void groups.refetch()}>
              <Typography.Paragraph className="text-accent">
                {t("mobile.server.connectors.whatsapp.tryAgain")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );
  const allowed = whatsapp.data?.accounts.find((entry) => entry.workspaceId === workspaceId)?.allowedSenders ?? [];
  const added = (groupId: string) => allowed.some((sender) => sender.id === groupId);
  const query = search.trim().toLocaleLowerCase();
  const matches = query ? list.filter((group) => group.name.toLocaleLowerCase().includes(query)) : list;
  const add = (group: { id: string; name: string }) =>
    void action
      .perform(async () => {
        await addWhatsAppSender({ workspaceId, sender: { kind: "group", id: group.id, name: group.name } }, server.id);
      })
      .then((done) => {
        if (done && router.canGoBack()) router.back();
      });
  return (
    <SettingsContent>
      <SettingsNote>{t("mobile.server.connectors.whatsapp.groupDescription")}</SettingsNote>
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
          {errorMessage(
            action.error,
            t("mobile.server.connectors.actionFailed", { name: t("mobile.server.connectors.whatsapp.title") }),
          )}
        </Typography.Paragraph>
      ) : null}
      {list.length === 0 ? (
        <SettingsNote>{t("mobile.server.connectors.whatsapp.groupsEmpty")}</SettingsNote>
      ) : (
        <>
          <SheetFormField
            label={t("mobile.server.connectors.whatsapp.groupSearch")}
            hideLabel
            placeholder={t("mobile.server.connectors.whatsapp.groupSearch")}
            autoCorrect={false}
            returnKeyType="search"
            value={search}
            onChangeText={setSearch}
          />
          {matches.length === 0 ? (
            <SettingsNote>{t("mobile.server.connectors.whatsapp.groupsNoMatch")}</SettingsNote>
          ) : (
            <SettingsSection>
              {matches.map((group) => {
                const done = added(group.id);
                return (
                  <SettingsRow
                    key={group.id}
                    disclosure={false}
                    disabled={action.busy || done}
                    accessibilityLabel={t("mobile.server.connectors.rowAction", {
                      action: t(
                        done ? "mobile.server.connectors.whatsapp.groupAdded" : "mobile.server.connectors.whatsapp.add",
                      ),
                      name: group.name,
                    })}
                    trailing={
                      <Typography.Paragraph type="body-xs" className={done ? "text-grouped-secondary" : "text-accent"}>
                        {t(
                          done
                            ? "mobile.server.connectors.whatsapp.groupAdded"
                            : "mobile.server.connectors.whatsapp.add",
                        )}
                      </Typography.Paragraph>
                    }
                    onPress={done ? undefined : () => add(group)}
                  >
                    <Typography.Paragraph numberOfLines={1}>{group.name}</Typography.Paragraph>
                  </SettingsRow>
                );
              })}
            </SettingsSection>
          )}
        </>
      )}
    </SettingsContent>
  );
}
