import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { PERMANENT_INVITE_EXPIRES_AT_MS } from "@openbot/contracts/invite-links";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { runTeamEffect } from "@openbot/team-client";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import Link from "lucide-react-native/icons/link";
import Mail from "lucide-react-native/icons/mail";
import Repeat from "lucide-react-native/icons/repeat";
import { useState } from "react";
import { Alert, Share } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { SERVER_ROLE_KEYS, SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";

const EMAIL_PLACEHOLDER = "name@example.com";

type InviteMethod = "email" | "link" | "permanent";

const METHOD_TEXT = {
  email: { title: "mobile.server.members.email", icon: Mail },
  link: { title: "mobile.server.members.inviteLink", icon: Link },
  permanent: { title: "mobile.server.members.permanentLink", icon: Repeat },
} as const;

const EXPIRY_FORMAT = { month: "short", day: "numeric", hour: "numeric", minute: "numeric" } as const;

/**
 * Server sheet > Members > Invite people: an email invitation, a one-time link or a permanent link.
 * The header action sends or creates it. The links that still work are below, and a tap revokes one.
 */
export function ServerInviteScreen() {
  const { t, format, errorMessage } = useText();
  const { theme } = useUniwind();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const {
    server,
    teamDirectory,
    canManage,
    invites,
    pendingInvites,
    activeMembers,
    memberLimit,
    membersFull,
    action,
    perform,
  } = useServerMembers(serverId);
  const [method, setMethod] = useState<InviteMethod>("link");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [created, setCreated] = useState<{
    inviteId: string;
    inviteUrl: string;
    expiresAt: number;
    email?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  if (!server || !canManage)
    return (
      <SettingsContent>
        <SettingsNote>
          {t(server ? "mobile.server.members.inviteNotAllowed" : "mobile.server.unavailable")}
        </SettingsNote>
      </SettingsContent>
    );
  const links = pendingInvites?.filter((invite) => !invite.email) ?? [];
  const permanentCount = links.filter((invite) => invite.permanent).length;
  const permanentLimitReached = method === "permanent" && permanentCount >= INPUT_LIMITS.maxPermanentInvites;
  const normalizedEmail = normalizeEmailAddress(email);
  const inviteUsed = Boolean(
    created &&
      invites.data?.some((invite) => invite.inviteId === created.inviteId && !invite.permanent && invite.usedAt),
  );
  const host = { hostId: server.id, devicePublicKey: server.publicKey, name: server.name };

  function choose(next: InviteMethod) {
    if (next === method) return;
    void haptics.selection();
    setMethod(next);
    setCreated(null);
    setCopied(false);
    action.reset();
  }

  function invite() {
    void perform(async () => {
      if (method === "email") {
        if (!normalizedEmail) throw new Error(currentText().t("mobile.server.members.invalidEmail"));
        const sent = await runTeamEffect(teamDirectory.sendInviteEmail(host, { role, email: normalizedEmail }));
        setCreated({ ...sent, email: normalizedEmail });
        setEmail("");
      } else {
        setCreated(
          await runTeamEffect(
            teamDirectory.createInvite(host, { role, ...(method === "permanent" ? { permanent: true } : {}) }),
          ),
        );
      }
      setCopied(false);
    });
  }

  function copy(url: string) {
    void Clipboard.setStringAsync(url)
      .then(() => {
        setCopied(true);
        void haptics.notification("success");
      })
      .catch((error: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          error,
          "other",
          text.t("mobile.server.members.copyFailed"),
          text.t("mobile.server.members.copyFailedBody"),
        );
      });
  }

  const createdNote = created
    ? inviteUsed
      ? t("mobile.server.members.inviteUsed")
      : created.email
        ? t("mobile.server.members.inviteSent", { email: created.email })
        : created.expiresAt >= PERMANENT_INVITE_EXPIRES_AT_MS
          ? t("mobile.server.members.permanentCreated")
          : t("mobile.server.members.oneTimeCreated", { date: format.date(created.expiresAt, EXPIRY_FORMAT) })
    : null;

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={method !== "email" || email.trim() !== ""}
        canSave={(method !== "email" || Boolean(normalizedEmail)) && !permanentLimitReached && !membersFull}
        pending={action.isPending}
        label={method === "email" ? t("mobile.server.members.send") : t("mobile.server.members.create")}
        pendingLabel={t("mobile.server.members.inviting")}
        onSave={invite}
      />
      <SettingsSection title={t("mobile.server.members.inviteWith")}>
        {(["email", "link", "permanent"] as const).map((choice) => {
          const Icon = METHOD_TEXT[choice].icon;
          return (
            <SettingsRow
              key={choice}
              checked={choice === method}
              disabled={action.isPending}
              disclosure={false}
              leading={<Icon size={20} color={muted} strokeWidth={1.75} />}
              supportingText={
                choice === "email"
                  ? t("mobile.server.members.emailHint")
                  : choice === "permanent"
                    ? t("mobile.server.members.permanentHint", { limit: INPUT_LIMITS.maxPermanentInvites })
                    : t("mobile.server.members.linkHint")
              }
              trailing={choice === method ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => choose(choice)}
            >
              <Typography.Paragraph>{t(METHOD_TEXT[choice].title)}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
      {method === "email" ? (
        <SheetFormField
          label={t("mobile.server.members.email")}
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
          onSubmitEditing={() => {
            if (normalizedEmail && !membersFull && !action.isPending) invite();
          }}
        />
      ) : null}
      <SettingsSection
        footer={
          membersFull
            ? t("mobile.server.members.full", { limit: memberLimit })
            : permanentLimitReached
              ? t("mobile.server.members.permanentLimit")
              : activeMembers
                ? t("mobile.server.members.limitCount", { count: activeMembers.length, limit: memberLimit })
                : undefined
        }
      >
        <SettingsRow
          disclosure={false}
          trailing={
            <SettingsPicker
              value={role}
              options={[
                { value: "member", label: t(SERVER_ROLE_LABEL_KEYS.member) },
                { value: "admin", label: t(SERVER_ROLE_LABEL_KEYS.admin) },
              ]}
              enabled={!action.isPending}
              dark={theme === "dark"}
              label={t("mobile.server.members.role")}
              onChange={(value) => {
                void haptics.selection();
                setRole(value);
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.server.members.role")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="-mt-4 px-4 text-danger-text" type="body-xs">
          {errorMessage(action.error, t("mobile.server.members.updateFailed"))}
        </Typography.Paragraph>
      ) : null}
      {created && !created.email ? (
        <SettingsSection title={t("mobile.server.members.newLink")} footer={createdNote}>
          <SettingsRow disclosure={false}>
            <Typography.Paragraph
              selectable
              numberOfLines={1}
              ellipsizeMode="middle"
              className="text-grouped-secondary"
            >
              {created.inviteUrl}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} disabled={inviteUsed} onPress={() => copy(created.inviteUrl)}>
            <Typography.Paragraph className="text-accent">
              {copied ? t("common.copied") : t("mobile.server.members.copyLink")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            disabled={inviteUsed}
            onPress={() =>
              // The share sheet is the user's own action: closing it is not a failure.
              void Share.share(isIOS ? { url: created.inviteUrl } : { message: created.inviteUrl }).catch(
                () => undefined,
              )
            }
          >
            <Typography.Paragraph className="text-accent">{t("mobile.server.members.shareLink")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : createdNote ? (
        <SettingsNote>{createdNote}</SettingsNote>
      ) : null}
      {links.length > 0 || invites.isError ? (
        <SettingsSection
          title={t("mobile.server.members.activeLinks")}
          footer={invites.isError ? t("mobile.server.members.invitationsLoadFailed") : undefined}
        >
          {links.map((link) => (
            <SettingsRow
              key={link.inviteId}
              disabled={action.isPending}
              disclosure={false}
              leading={
                link.permanent ? (
                  <Repeat size={20} color={muted} strokeWidth={1.75} />
                ) : (
                  <Link size={20} color={muted} strokeWidth={1.75} />
                )
              }
              supportingText={
                link.permanent
                  ? t("mobile.server.members.permanentInviteRow", {
                      role: t(SERVER_ROLE_KEYS[link.role]),
                      uses: link.useCount,
                    })
                  : t("mobile.server.members.inviteRow", { role: t(SERVER_ROLE_KEYS[link.role]) })
              }
              onPress={() =>
                Alert.alert(t("mobile.server.members.revokeTitle"), t("mobile.server.members.revokeBody"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.members.revoke"),
                    style: "destructive",
                    onPress: () =>
                      void perform(async () => {
                        await runTeamEffect(teamDirectory.revokeInvite(link.inviteId));
                        if (created?.inviteId === link.inviteId) setCreated(null);
                      }),
                  },
                ])
              }
            >
              <Typography.Paragraph>
                {link.permanent ? t("mobile.server.members.permanentLink") : t("mobile.server.members.inviteLink")}
              </Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
