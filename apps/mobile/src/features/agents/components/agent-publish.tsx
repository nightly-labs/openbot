import type { AgentTemplatePreview } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useState } from "react";
import { Alert, Share, View } from "react-native";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { currentText, type MobileText, useText } from "@/shared/lib/text";

/** The longest instruction summary, so a long text does not fill the page. */
const SUMMARY_LENGTH = 120;

/**
 * Agent info > Publish: shares the agent as a link-only template, as the desktop publish dialog does.
 * The host builds the template, refuses secrets and publishes it with its own account. The phone
 * sends only the agent id: it draws no share card, so the link preview shows the general OpenBot
 * image. Like the desktop dialog, the page shows a summary of the template. A sheet has no action
 * button in its content, so Publish (Update, when the agent is published) is in the header. Only an
 * owner or admin opens it, and the host checks the role again.
 */
export function AgentPublish({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const text = useText();
  const { t, format, sourceText } = text;
  const workspace = useMobileWorkspace();
  const queryClient = useQueryClient();
  const { session, sessionScope } = useMobileSession();
  const [pending, setPending] = useState<"publish" | "unpublish" | null>(null);
  const queryKey = ["agent-info", session?.apiUrl, session?.user.id, sessionScope, agent.serverId, agent.id, "publish"];
  const preview = useQuery({
    queryKey,
    queryFn: () => workspace.loadAgentTemplatePreview(agent.id, agent.serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (!available) return <Typography.Paragraph>{t("mobile.agent.publish.reconnect")}</Typography.Paragraph>;
  if (preview.isPending) return <Typography.Paragraph>{t("mobile.agent.publish.loading")}</Typography.Paragraph>;
  if (preview.isError)
    return (
      <View className="gap-2">
        <Typography.Paragraph accessibilityRole="alert">{t("mobile.agent.publish.failed")}</Typography.Paragraph>
        <Button variant="ghost" onPress={() => void preview.refetch()}>
          <Button.Label>{t("mobile.agent.publish.retry")}</Button.Label>
        </Button>
      </View>
    );
  const template = preview.data;
  const publication = template.publication;
  const blocked = pending !== null || Boolean(template.skillsError);

  function setPublication(next: AgentTemplatePreview["publication"]) {
    queryClient.setQueryData<AgentTemplatePreview>(queryKey, (current) =>
      current ? { ...current, publication: next } : current,
    );
  }

  async function run(kind: "publish" | "unpublish", action: () => Promise<void>, failed: string): Promise<void> {
    if (pending) return;
    setPending(kind);
    try {
      await action();
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      const latest = currentText();
      showFailureAlert(cause, "agent", failed, latest.errorMessage(cause, latest.t("mobile.agent.publish.failedBody")));
    } finally {
      setPending(null);
    }
  }

  // The share sheet is the user's own action: closing it is not a failure.
  const openShareSheet = (link: string) =>
    Share.share(isIOS ? { url: link } : { message: link }).catch(() => undefined);

  /**
   * Publishes the agent, or updates its template to the current version. After the first publish
   * the share sheet opens with the new link, as desktop copies it. It opens after the publish ends,
   * so the page does not show the publish as still running.
   */
  const publish = () => {
    const first = !publication;
    let link: string | null = null;
    void run(
      "publish",
      async () => {
        const published = await workspace.publishAgentTemplate(agent.id, agent.serverId);
        setPublication(published);
        link = published.shareUrl;
      },
      t(first ? "mobile.agent.publish.publishFailed" : "mobile.agent.publish.updateFailed"),
    ).then(() => {
      if (first && link) void openShareSheet(link);
    });
  };

  const confirmUnpublish = () =>
    Alert.alert(t("mobile.agent.publish.unpublishTitle"), t("mobile.agent.publish.unpublishBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.agent.publish.unpublish"),
        style: "destructive",
        onPress: () =>
          void run(
            "unpublish",
            async () => {
              await workspace.unpublishAgentTemplate(agent.id, agent.serverId);
              setPublication(null);
            },
            t("mobile.agent.publish.unpublishFailed"),
          ),
      },
    ]);

  const instructions = firstLine(template.description) || template.title.trim();
  return (
    <View className="gap-7">
      <View className="items-center gap-1">
        <View className="mb-2">
          <BloubAvatarPreview
            agentId={agent.id}
            serverId={agent.serverId}
            seed={agent.avatarSeed}
            hue={agent.avatarHue}
            size={80}
          />
        </View>
        <Typography.Heading type="h3" align="center">
          {template.name}
        </Typography.Heading>
        <Typography.Paragraph
          type="body-sm"
          align="center"
          className={publication ? "text-success-text" : "text-grouped-secondary"}
        >
          {publication && Number.isFinite(Date.parse(publication.publishedAt))
            ? t("mobile.agent.publish.publishedOn", {
                date: format.date(new Date(publication.publishedAt), { dateStyle: "medium" }),
              })
            : t(publication ? "mobile.agent.publish.published" : "mobile.agent.publish.notPublished")}
        </Typography.Paragraph>
      </View>
      <SettingsSection title={t("mobile.agent.publish.contents")} footer={t("mobile.agent.publish.notIncluded")}>
        <SettingsRow supportingText={instructions || t("mobile.agent.publish.noInstructions")}>
          <Typography.Paragraph>{t("mobile.agent.publish.instructions")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          supportingText={summary(
            template.skills.map((skill) => skill.name),
            "mobile.agent.publish.noSkills",
            text,
          )}
        >
          <Typography.Paragraph>{t("mobile.agent.publish.skills")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          supportingText={summary(
            template.routines.map((routine) => routine.name),
            "mobile.agent.publish.noRoutines",
            text,
          )}
        >
          <Typography.Paragraph>{t("mobile.agent.publish.routines")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {template.skillsError ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {t("mobile.agent.publish.skillsError", { reason: sourceText(template.skillsError) })}
        </Typography.Paragraph>
      ) : null}
      {publication ? (
        <>
          <SettingsSection>
            <SettingsRow disclosure={false} onPress={() => void openShareSheet(publication.shareUrl)}>
              <Typography.Paragraph>{t("mobile.agent.publish.shareLink")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={pending !== null} onPress={confirmUnpublish}>
              <Typography.Paragraph className="text-danger-text">
                {t(pending === "unpublish" ? "mobile.agent.publish.unpublishing" : "mobile.agent.publish.unpublish")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
      <PublishAction
        disabled={blocked}
        label={t(
          pending === "publish"
            ? publication
              ? "mobile.agent.publish.updating"
              : "mobile.agent.publish.publishing"
            : publication
              ? "mobile.agent.publish.update"
              : "mobile.agent.publish.publish",
        )}
        onPress={publish}
      />
    </View>
  );
}

/** The header action of the page, a text button as desktop has: the native toolbar on iOS. */
function PublishAction({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  const press = () => {
    if (disabled) return;
    void haptics.impact("light");
    onPress();
  };
  if (isAndroid)
    return (
      <AndroidHeaderButton
        placement="right"
        text={label}
        disabled={disabled}
        accessibilityLabel={label}
        onPress={press}
      />
    );
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button disabled={disabled} accessibilityLabel={label} onPress={press}>
        {label}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

/** The first line of a text, cut at a word near `SUMMARY_LENGTH`. */
function firstLine(value: string): string {
  const line = value.trim().split("\n")[0]?.trim() ?? "";
  if (line.length <= SUMMARY_LENGTH) return line;
  const cut = line.slice(0, SUMMARY_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : SUMMARY_LENGTH).trimEnd()}…`;
}

/** Up to two names, or the first name and how many more, as the desktop dialog summarizes them. */
function summary(
  names: string[],
  empty: "mobile.agent.publish.noSkills" | "mobile.agent.publish.noRoutines",
  { t, format }: MobileText,
): string {
  const [first] = names;
  if (first === undefined) return t(empty);
  if (names.length <= 2) return format.list(names);
  return t("mobile.agent.publish.andOthers", { name: first, count: names.length - 1 });
}
