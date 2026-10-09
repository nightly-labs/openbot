import type { AgentSessionSettings, AgentSessionSettingValue } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { Fragment, useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { currentText, useText } from "@/shared/lib/text";

export function AgentSessionSettingsSection({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { loadAgentSessionSettings, setAgentSessionSetting, resetAgentSessionSetting } = useMobileWorkspace();
  const [settings, setSettings] = useState<AgentSessionSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSettings(null);
    setFailed(false);
    if (available) {
      loadAgentSessionSettings(agent.id, agent.serverId).then(
        (value) => {
          if (active) setSettings(value);
        },
        () => {
          if (active) setFailed(true);
        },
      );
    }
    return () => {
      active = false;
    };
  }, [agent.id, agent.serverId, available, loadAgentSessionSettings]);

  async function save(settingId: string, value?: AgentSessionSettingValue): Promise<void> {
    setBusy(true);
    try {
      setSettings(
        await (value === undefined
          ? resetAgentSessionSetting({ agentId: agent.id, settingId }, agent.serverId)
          : setAgentSessionSetting({ agentId: agent.id, settingId, value }, agent.serverId)),
      );
    } catch (cause) {
      const text = currentText();
      showFailureAlert(
        cause,
        "agent",
        text.t("mobile.agent.session.failed"),
        text.errorMessage(cause, text.t("mobile.agent.session.failed")),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!failed && !settings?.options.length) return null;
  return (
    <SettingsSection
      title={t("mobile.agent.session.title")}
      footer={settings?.pending ? t("mobile.agent.session.pending") : undefined}
    >
      {failed ? (
        <SettingsRow>
          <Typography.Paragraph>{t("mobile.agent.session.readFailed")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {settings?.options.map((option) => {
        const saved = settings.overrides[option.id];
        const invalid =
          option.type === "select" &&
          typeof saved === "string" &&
          !option.options.some((choice) => choice.value === saved);
        return (
          <Fragment key={option.id}>
            <SettingsRow
              supportingText={
                invalid ? t("mobile.agent.session.unavailable", { value: String(saved) }) : option.description
              }
              trailing={
                option.type === "select" ? (
                  <SettingsPicker
                    label={option.name}
                    value={typeof saved === "string" && !invalid ? saved : option.currentValue}
                    options={option.options.map((choice) => ({ value: choice.value, label: choice.name }))}
                    enabled={available && !busy}
                    dark={theme === "dark"}
                    onChange={(value) => void save(option.id, value)}
                  />
                ) : undefined
              }
            >
              {option.type === "boolean" ? (
                <SettingsSwitch
                  value={typeof saved === "boolean" ? saved : option.currentValue}
                  disabled={!available || busy}
                  label={option.name}
                  dark={theme === "dark"}
                  onValueChange={(value) => void save(option.id, value)}
                />
              ) : (
                <Typography.Paragraph>{option.name}</Typography.Paragraph>
              )}
            </SettingsRow>
            {Object.hasOwn(settings.overrides, option.id) ? (
              <SettingsRow disclosure={false} disabled={!available || busy} onPress={() => void save(option.id)}>
                <Typography.Paragraph>{t("mobile.agent.session.reset", { name: option.name })}</Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </Fragment>
        );
      })}
    </SettingsSection>
  );
}
