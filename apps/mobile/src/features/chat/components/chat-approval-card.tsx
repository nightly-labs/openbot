import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Folder, ShieldAlert } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { showWarningAlert } from "@/features/analytics/failure-reports";
import {
  approvalIsPartial,
  InactiveRequestError,
  type PendingApproval,
} from "@/features/workspace/model/pending-approvals";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";

export type ApprovalDecision = "accept" | "decline";

/**
 * A command that only wraps its body in a login shell, such as `/bin/zsh -lc "…"`. The body shows
 * only when the shell reads it literally: single quotes, or double quotes with no escape, variable or
 * substitution. Any other command shows as the host sent it.
 */
const SHELL_WRAPPER = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh -l?c (?:'([^']*)'|"([^"\\$`]*)")$/su;
const HOME_FOLDER = /^(?:\/Users|\/home)\/[^/]+(?=\/|$)/u;

export function approvalTitle(approval: PendingApproval, t: MobileText["t"]): string {
  if (approval.kind === "command") return t("mobile.chat.approval.title.command");
  if (approval.kind === "file-change") return t("mobile.chat.approval.title.fileChange");
  return t("mobile.chat.approval.title.permissions");
}

function commandText(command: string) {
  const match = SHELL_WRAPPER.exec(command);
  return match?.[1] ?? match?.[2] ?? command;
}

function shortPath(path: string) {
  return path.replace(HOME_FOLDER, "~");
}

/**
 * An approval that an agent waits on, answered from the phone. It shows what the desktop card shows
 * and says what each answer does on the host. A request that the phone has only in part offers Deny
 * only: Allow must not cover text the user cannot see.
 */
export function ChatApprovalCard({
  approval,
  agentName,
  showAgentName,
  serverName,
  canAnswer,
  respond,
}: {
  approval: PendingApproval;
  agentName: string;
  /** In a channel, several agents can ask. In an agent's own chat, the name is the chat's. */
  showAgentName: boolean;
  serverName: string;
  canAnswer: boolean;
  respond: (decision: ApprovalDecision) => Promise<void>;
}) {
  const { t, errorMessage, sourceText } = useText();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const [warningText] = useCSSVariable(["--openbot-warning-text"]);
  const [pending, setPending] = useState<ApprovalDecision | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const partial = approvalIsPartial(approval);
  const disabled = !canAnswer || pending !== null;
  const permissions = approval.kind === "permissions" ? approval.permissions : null;
  const permissionDetails = permissions
    ? [
        ...(permissions.network ? [t("mobile.chat.approval.network")] : []),
        ...permissions.fileSystem.read.map((path) => t("mobile.chat.approval.read", { path: shortPath(path) })),
        ...permissions.fileSystem.write.map((path) => t("mobile.chat.approval.write", { path: shortPath(path) })),
      ]
    : [];
  const names = { name: agentName, server: serverName };
  const effect = partial
    ? t("mobile.chat.approval.partial", names)
    : approval.kind === "command"
      ? t("mobile.chat.approval.effect.command", names)
      : approval.kind === "file-change"
        ? t("mobile.chat.approval.effect.fileChange", names)
        : t("mobile.chat.approval.effect.permissions", names);
  const hasDetails = Boolean(approval.command) || approval.kind === "file-change" || permissionDetails.length > 0;

  async function answer(decision: ApprovalDecision) {
    if (disabled) return;
    void haptics.selection();
    setPending(decision);
    setFailed(null);
    try {
      await respond(decision);
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      if (error instanceof InactiveRequestError) {
        // The card is gone with its request. The alert says why the answer did not count.
        showWarningAlert("turn", t("mobile.chat.approval.inactiveTitle"), error.message);
        return;
      }
      setFailed(errorMessage(error, t("mobile.chat.approval.sendFailed")));
    } finally {
      setPending(null);
    }
  }

  return (
    <View
      className="w-full gap-3 rounded-[30px] bg-control/60 p-4"
      style={{ borderCurve: "circular" }}
      accessibilityLabel={t("mobile.chat.approval.label")}
      accessibilityState={{ busy: pending !== null }}
    >
      <View className="gap-1">
        {showAgentName ? (
          <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
            {t("mobile.chat.approval.from", { name: agentName })}
          </Typography.Paragraph>
        ) : null}
        <View className="flex-row items-center gap-2">
          <ShieldAlert color={String(warningText)} size={16} strokeWidth={2.2} />
          <Typography.Paragraph weight="semibold" className="min-w-0 flex-1" accessibilityRole="header">
            {approvalTitle(approval, t)}
          </Typography.Paragraph>
        </View>
        {approval.reason ? (
          <Typography.Paragraph type="body-sm" className="text-text-secondary">
            {sourceText(approval.reason)}
          </Typography.Paragraph>
        ) : null}
      </View>

      {hasDetails ? (
        <View className="gap-2 rounded-[18px] bg-control px-3 py-2.5" style={{ borderCurve: "continuous" }}>
          {approval.command ? (
            <Typography.Code
              selectable
              className="bg-transparent p-0"
              style={{ color: foreground, fontSize: 13, lineHeight: 19 }}
            >
              {commandText(approval.command)}
            </Typography.Code>
          ) : null}
          {approval.kind === "file-change" ? (
            <View className="gap-0.5">
              <Typography.Paragraph type="body-xs" className="text-muted">
                {t("mobile.chat.approval.files")}
              </Typography.Paragraph>
              <Typography.Paragraph type="body-sm" weight="medium" selectable>
                {approval.grantRoot ? shortPath(approval.grantRoot) : t("mobile.chat.approval.agentWorkspace")}
              </Typography.Paragraph>
            </View>
          ) : null}
          {permissionDetails.length ? (
            <View className="gap-1" accessibilityLabel={t("mobile.chat.approval.permissions")}>
              {permissionDetails.map((detail) => (
                <Typography.Paragraph key={detail} type="body-sm" selectable>
                  {detail}
                </Typography.Paragraph>
              ))}
            </View>
          ) : null}
          {approval.command && approval.cwd ? (
            <View className="flex-row items-center gap-1.5">
              <Folder color={String(muted)} size={12} />
              <Typography.Paragraph type="body-xs" className="min-w-0 flex-1 text-muted" numberOfLines={1} selectable>
                {shortPath(approval.cwd)}
              </Typography.Paragraph>
            </View>
          ) : null}
        </View>
      ) : null}

      <View className="gap-2.5">
        <Typography.Paragraph type="body-xs" className="text-muted">
          {effect}
        </Typography.Paragraph>
        <View className="flex-row gap-2">
          <Button variant="tertiary" className="flex-1" isDisabled={disabled} onPress={() => void answer("decline")}>
            <Button.Label>{pending === "decline" ? t("common.sending") : t("mobile.chat.approval.deny")}</Button.Label>
          </Button>
          {partial ? null : (
            // The neutral action color, as on desktop: white in dark mode, black in light mode.
            <Button className="flex-1 bg-action" isDisabled={disabled} onPress={() => void answer("accept")}>
              <Button.Label className="text-action-foreground">
                {pending === "accept" ? t("common.sending") : t("mobile.chat.approval.allow")}
              </Button.Label>
            </Button>
          )}
        </View>
        {!canAnswer ? (
          <Typography.Paragraph type="body-xs" className="text-text-secondary">
            {t("mobile.chat.approval.reconnect", { server: serverName })}
          </Typography.Paragraph>
        ) : null}
        {failed ? (
          <Typography.Paragraph type="body-xs" className="text-danger-text" accessibilityRole="alert">
            {failed}
          </Typography.Paragraph>
        ) : null}
      </View>
    </View>
  );
}
