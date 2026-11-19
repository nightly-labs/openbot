import { feedbackApproval } from "@openbot/team-client/feedback-approval";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Folder from "lucide-react-native/icons/folder";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { showWarningAlert } from "@/features/analytics/failure-reports";
import {
  phoneNetwork,
  refreshPhoneNetwork,
  subscribePhoneNetwork,
} from "@/features/support/model/phone-network-capture";
import { showPhoneFeedback } from "@/features/support/model/support-log-capture";
import {
  approvalIsPartial,
  InactiveRequestError,
  type PendingApproval,
} from "@/features/workspace/model/pending-approvals";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";

export type ApprovalDecision = "accept" | "decline";

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

function wholeReadFailed(error: unknown) {
  return !(error instanceof InactiveRequestError);
}

function shortPath(path: string) {
  return path.replace(HOME_FOLDER, "~");
}

export function ChatApprovalCard({
  approval,
  agentName,
  showAgentName,
  serverName,
  canAnswer,
  respond,
  readsWhole,
  loadWhole,
}: {
  approval: PendingApproval;
  agentName: string;
  showAgentName: boolean;
  serverName: string;
  canAnswer: boolean;
  respond: (decision: ApprovalDecision) => Promise<void>;
  readsWhole: boolean;
  loadWhole: () => Promise<void>;
}) {
  const { t, errorMessage, sourceText } = useText();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const [warningText] = useCSSVariable(["--openbot-warning-text"]);
  const [pending, setPending] = useState<ApprovalDecision | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [wholeFailed, setWholeFailed] = useState(false);
  const partial = approvalIsPartial(approval);
  const disabled = !canAnswer || pending !== null;
  const report = feedbackApproval(approval);
  const reading = partial && readsWhole && canAnswer;
  const phoneReport = report?.phone === true;
  const { agentId, requestId } = approval;
  const phone = useMemo(
    () => (phoneReport ? showPhoneFeedback({ agentId, requestId }) : null),
    [phoneReport, agentId, requestId],
  );
  const network = useSyncExternalStore(subscribePhoneNetwork, phoneNetwork);
  useEffect(() => {
    if (phoneReport) void refreshPhoneNetwork();
  }, [phoneReport]);

  const loadWholeRef = useRef(loadWhole);
  loadWholeRef.current = loadWhole;
  useEffect(() => {
    if (!reading) return;
    let current = true;
    setWholeFailed(false);
    loadWholeRef.current().then(
      () => {
        if (current) setWholeFailed(true);
      },
      (error: unknown) => {
        if (current && wholeReadFailed(error)) setWholeFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [reading]);
  function retryWhole() {
    setWholeFailed(false);
    loadWhole().then(
      () => setWholeFailed(true),
      (error: unknown) => {
        if (wholeReadFailed(error)) setWholeFailed(true);
      },
    );
  }
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
    ? !readsWhole
      ? t("mobile.chat.approval.partial", names)
      : !reading
        ? null
        : wholeFailed
          ? t("mobile.chat.approval.loadFailed")
          : t("mobile.chat.approval.loading")
    : report
      ? null
      : approval.kind === "command"
        ? t("mobile.chat.approval.effect.command", names)
        : approval.kind === "file-change"
          ? t("mobile.chat.approval.effect.fileChange", names)
          : t("mobile.chat.approval.effect.permissions", names);
  const hasDetails =
    !report && (Boolean(approval.command) || approval.kind === "file-change" || permissionDetails.length > 0);
  const reportText = report?.text
    .split("\n\n")
    .map((part) => sourceText(part))
    .join("\n\n");

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
        showWarningAlert("turn", t("mobile.chat.approval.inactiveTitle"), error.message);
        return;
      }
      setFailed(errorMessage(error, t("mobile.chat.approval.sendFailed")));
    } finally {
      setPending(null);
    }
  }

  const acceptLabel =
    pending === "accept"
      ? t("common.sending")
      : report
        ? t("mobile.chat.approval.report.send")
        : t("mobile.chat.approval.allow");
  const declineLabel =
    pending === "decline"
      ? t("common.sending")
      : report
        ? t("mobile.chat.approval.report.dontSend")
        : t("mobile.chat.approval.deny");

  const acceptButton = () =>
    partial ? null : (
      <Button
        size="sm"
        variant={report ? "primary" : "tertiary"}
        className={report ? "flex-1 rounded-full" : "rounded-full"}
        isDisabled={disabled}
        onPress={() => void answer("accept")}
      >
        <Button.Label className="font-sans font-semibold">{acceptLabel}</Button.Label>
      </Button>
    );
  return (
    <View
      className="w-full gap-2.5"
      accessibilityLabel={t("mobile.chat.approval.label")}
      accessibilityState={{ busy: pending !== null }}
    >
      <View
        className="max-w-[92%] self-start gap-2.5 rounded-[20px] bg-control/60 px-4 py-3"
        style={{ borderCurve: "circular" }}
      >
        {showAgentName ? (
          <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
            {t("mobile.chat.approval.from", { name: agentName })}
          </Typography.Paragraph>
        ) : null}
        {report ? (
          <View className="gap-2.5">
            <View className="items-center gap-1 pt-1">
              <Typography.Paragraph style={{ fontSize: 32, lineHeight: 40 }} accessible={false}>
                {report.kind === "idea" ? "💡" : "🐞"}
              </Typography.Paragraph>
              <Typography.Paragraph weight="semibold" className="text-center" accessibilityRole="header">
                {t(
                  report.kind === "idea"
                    ? "mobile.chat.approval.report.ideaHeadline"
                    : "mobile.chat.approval.report.bugHeadline",
                )}
              </Typography.Paragraph>
            </View>
            <ScrollView className={phone ? "max-h-56 grow-0" : "max-h-72 grow-0"} nestedScrollEnabled>
              <View className="gap-1 border-s-[3px] border-border ps-3">
                <Typography.Paragraph weight="medium" selectable>
                  {report.title}
                </Typography.Paragraph>
                {reportText ? (
                  <Typography.Paragraph type="body-sm" className="text-text-secondary" selectable>
                    {reportText}
                  </Typography.Paragraph>
                ) : null}
              </View>
            </ScrollView>
            {phone ? (
              <View className="gap-1">
                <Typography.Paragraph type="body-xs" className="text-muted">
                  {t("mobile.chat.approval.report.phoneAdds")}
                </Typography.Paragraph>
                <Typography.Paragraph type="body-xs" className="text-text-secondary" selectable>
                  {`${phone.platform} · ${phone.appVersion}\n${phone.system}\n${network}`}
                </Typography.Paragraph>
                <ScrollView className="max-h-32 grow-0 rounded-xl bg-control px-2 py-1.5" nestedScrollEnabled>
                  <Typography.Code
                    selectable
                    className="bg-transparent p-0"
                    style={{ color: foreground, fontSize: 11, lineHeight: 15 }}
                  >
                    {phone.log}
                  </Typography.Code>
                </ScrollView>
              </View>
            ) : null}
            {approval.reason ? (
              <Typography.Paragraph type="body-xs" className="text-muted">
                {sourceText(approval.reason)}
              </Typography.Paragraph>
            ) : null}
          </View>
        ) : (
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <ShieldAlert color={String(warningText)} size={16} strokeWidth={2.2} />
              <Typography.Paragraph weight="semibold" className="min-w-0 flex-1" accessibilityRole="header">
                {approvalTitle(approval, t)}
              </Typography.Paragraph>
            </View>
            {approval.reason ? <Typography.Paragraph>{sourceText(approval.reason)}</Typography.Paragraph> : null}
          </View>
        )}

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

        {effect ? (
          <Typography.Paragraph type="body-xs" className="text-text-secondary">
            {effect}
          </Typography.Paragraph>
        ) : null}
      </View>

      <View className={report ? "max-w-[92%] flex-row gap-2" : "flex-row flex-wrap gap-2"}>
        {report ? null : acceptButton()}
        <Button
          size="sm"
          variant="tertiary"
          className="rounded-full"
          isDisabled={disabled}
          onPress={() => void answer("decline")}
        >
          <Button.Label className="font-sans font-semibold">{declineLabel}</Button.Label>
        </Button>
        {report ? acceptButton() : null}
        {reading && wholeFailed ? (
          <Button
            size="sm"
            variant="tertiary"
            className="rounded-full"
            isDisabled={pending !== null}
            onPress={retryWhole}
          >
            <Button.Label className="font-sans font-semibold">{t("mobile.chat.approval.retry")}</Button.Label>
          </Button>
        ) : null}
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
  );
}
