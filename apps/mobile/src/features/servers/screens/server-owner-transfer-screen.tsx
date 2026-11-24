import type { OwnerTransfer } from "@openbot/contracts/owner-transfer";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { runTeamEffect } from "@openbot/team-client";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert, Keyboard } from "react-native";
import { confirmOwner } from "@/features/app-lock/model/app-lock";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useOwnerHostedServerIds } from "@/features/servers/model/server-settings-access";
import { useLockedMutation } from "@/features/servers/model/use-locked-action";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { useText } from "@/shared/lib/text";

const EMAIL_PLACEHOLDER = "name@example.com";
const EXPIRY_FORMAT = { dateStyle: "medium", timeStyle: "short" } as const;

export function ServerOwnerTransferScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, canTransferOwnership } = useMobileWorkspace();
  const server = servers.find((candidate) => candidate.id === serverId);
  const hostedServerIds = useOwnerHostedServerIds(server);
  const note = !server
    ? "mobile.server.unavailable"
    : server.hosted === true || hostedServerIds?.has(server.id)
      ? "mobile.server.ownerTransfer.hosted"
      : canTransferOwnership(server.id)
        ? null
        : "mobile.server.ownerTransfer.unavailable";
  if (!server || note)
    return (
      <SettingsContent>
        <SettingsNote>{t(note ?? "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return <OwnerTransferForm server={server} />;
}

function OwnerTransferForm({ server }: { server: MobileServer }) {
  const { t, format, errorMessage } = useText();
  const { teamDirectory } = useMobileWorkspace();
  const queryScope = useQueryScope();
  const pending = useQuery({
    queryKey: queryKeys.ownerTransfer(queryScope, server.id),
    retry: false,
    gcTime: 0,
    queryFn: () => runTeamEffect(teamDirectory.pendingOwnerTransfer(server.id)),
  });
  const { action, perform } = useLockedMutation({ success: () => void pending.refetch() });
  const [email, setEmail] = useState("");
  const normalizedEmail = normalizeEmailAddress(email);
  const transfer = pending.data ?? null;

  function confirmSend() {
    if (!normalizedEmail || action.isPending) return;
    Keyboard.dismiss();
    Alert.alert(
      t("mobile.server.ownerTransfer.confirmTitle", { email: normalizedEmail }),
      t("mobile.server.ownerTransfer.confirmBody", { email: normalizedEmail, server: server.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.ownerTransfer.confirm"),
          style: "destructive",
          onPress: () => void send(normalizedEmail),
        },
      ],
    );
  }

  async function send(target: string) {
    if (!(await confirmOwner())) return;
    await perform(async () => {
      await runTeamEffect(teamDirectory.startOwnerTransfer(server.id, target));
      setEmail("");
    });
  }

  function confirmCancel(current: OwnerTransfer) {
    Alert.alert(
      t("mobile.server.ownerTransfer.cancelTitle"),
      t("mobile.server.ownerTransfer.cancelBody", { email: current.toEmail }),
      [
        { text: t("mobile.server.ownerTransfer.keep"), style: "cancel" },
        {
          text: t("mobile.server.ownerTransfer.cancel"),
          style: "destructive",
          onPress: () => void perform(() => runTeamEffect(teamDirectory.cancelOwnerTransfer(server.id))),
        },
      ],
    );
  }

  const failure = action.error
    ? errorMessage(
        action.error,
        t(transfer ? "mobile.server.ownerTransfer.cancelFailed" : "mobile.server.ownerTransfer.sendFailed"),
      )
    : null;

  if (pending.isPending)
    return (
      <SettingsContent>
        <SettingsNote>{t("common.loading")}</SettingsNote>
      </SettingsContent>
    );

  if (transfer)
    return (
      <SettingsContent>
        <SettingsSection
          title={t("mobile.server.ownerTransfer.pending")}
          footer={failure ?? t("mobile.server.ownerTransfer.pendingNote", { email: transfer.toEmail })}
        >
          <SettingsRow
            disclosure={false}
            supportingText={t("mobile.server.ownerTransfer.expires", {
              date: format.date(transfer.expiresAt, EXPIRY_FORMAT),
            })}
          >
            <Typography.Paragraph numberOfLines={1}>{transfer.toEmail}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} disabled={action.isPending} onPress={() => confirmCancel(transfer)}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.ownerTransfer.cancel")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </SettingsContent>
    );

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={email.trim() !== ""}
        canSave={Boolean(normalizedEmail)}
        pending={action.isPending}
        label={t("mobile.server.ownerTransfer.send")}
        pendingLabel={t("mobile.server.ownerTransfer.sending")}
        onSave={confirmSend}
      />
      <SettingsNote>{t("mobile.server.ownerTransfer.lede")}</SettingsNote>
      <SheetFormField
        label={t("mobile.server.ownerTransfer.email")}
        isRequired
        placeholder={EMAIL_PLACEHOLDER}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="email"
        returnKeyType="send"
        editable={!action.isPending}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (action.error) action.reset();
        }}
        onSubmitEditing={confirmSend}
      />
      {failure ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text" type="body-xs">
          {failure}
        </Typography.Paragraph>
      ) : null}
      {pending.isError ? (
        <SettingsNote>{errorMessage(pending.error, t("mobile.server.ownerTransfer.loadFailed"))}</SettingsNote>
      ) : null}
      <SettingsNote>{t("mobile.server.ownerTransfer.stays")}</SettingsNote>
      <SettingsNote>{t("mobile.server.ownerTransfer.expiry")}</SettingsNote>
    </SettingsContent>
  );
}
