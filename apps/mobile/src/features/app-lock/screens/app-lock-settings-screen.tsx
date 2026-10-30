import { router } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useState } from "react";
import { useCSSVariable, useUniwind } from "uniwind";
import { deviceUnlockName } from "@/features/app-lock/components/app-lock-overlay";
import {
  checkDeviceUnlock,
  confirmOwner,
  turnOffAppLockPin,
  updateAppLockConfig,
  useAppLock,
} from "@/features/app-lock/model/app-lock";
import { appLockEnabled, LOCK_AFTER_OPTIONS_MS } from "@/features/app-lock/model/app-lock-storage";
import { type DeviceUnlockKind, deviceUnlockKind } from "@/features/app-lock/model/device-unlock";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";

function lockAfterLabel(ms: number, t: MobileText["t"]): string {
  if (ms === 0) return t("mobile.appLock.lockAfter.immediately");
  if (ms >= 3_600_000) return t("mobile.appLock.lockAfter.hours", { count: ms / 3_600_000 });
  return t("mobile.appLock.lockAfter.minutes", { count: ms / 60_000 });
}

export function AppLockSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const dark = theme === "dark";
  const accent = String(useCSSVariable("--openbot-accent"));
  const status = useAppLock((state) => state.status);
  const config = useAppLock((state) => state.config);
  const enabled = appLockEnabled(config);
  const [kind, setKind] = useState<DeviceUnlockKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const method = deviceUnlockName(kind, t);
  const disabled = status !== "ready" || saving;

  useEffect(() => {
    let active = true;
    void deviceUnlockKind().then((next) => {
      if (active) setKind(next);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Every change asks the owner to unlock first, so a person who finds the phone open cannot turn the lock off. */
  async function change(action: () => Promise<string | null | undefined>) {
    setError(null);
    setSaving(true);
    try {
      if (!(await confirmOwner())) return;
      const failure = await action();
      if (failure) {
        setError(failure);
        void haptics.notification("error");
      }
    } catch {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    } finally {
      setSaving(false);
    }
  }

  async function turnOnDeviceUnlock(): Promise<string | null> {
    const result = await checkDeviceUnlock(t("mobile.appLock.device.turnOnPrompt", { method }), t("common.cancel"));
    if (result === "success") {
      await updateAppLockConfig({ deviceUnlock: true });
      return null;
    }
    if (result === "unavailable") return t("mobile.appLock.device.unavailable");
    return result === "cancel" ? null : t("mobile.appLock.device.failed", { method });
  }

  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.appLock.methods.title")}
        footer={
          error ?? (kind ? t("mobile.appLock.methods.footer", { method }) : t("mobile.appLock.methods.footerPinOnly"))
        }
      >
        <SettingsRow>
          <SettingsSwitch
            value={config.pin}
            disabled={disabled}
            label={t("mobile.appLock.method.pin")}
            dark={dark}
            onValueChange={(next) =>
              void change(async () => {
                if (next) router.push("/settings/app-lock-pin");
                else await turnOffAppLockPin();
                return null;
              })
            }
          />
        </SettingsRow>
        {kind || config.deviceUnlock ? (
          <SettingsRow>
            <SettingsSwitch
              value={config.deviceUnlock}
              disabled={disabled}
              label={method}
              dark={dark}
              onValueChange={(next) =>
                void change(async () => {
                  if (next) return turnOnDeviceUnlock();
                  await updateAppLockConfig({ deviceUnlock: false });
                  return null;
                })
              }
            />
          </SettingsRow>
        ) : null}
        {config.pin ? (
          <SettingsRow
            disabled={disabled}
            onPress={() =>
              void change(async () => {
                router.push("/settings/app-lock-pin");
                return null;
              })
            }
          >
            <Typography.Paragraph>{t("mobile.appLock.changePin")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {enabled ? (
        <SettingsSection title={t("mobile.appLock.lockAfter.title")} footer={t("mobile.appLock.lockAfter.footer")}>
          {LOCK_AFTER_OPTIONS_MS.map((ms) => (
            <SettingsRow
              key={ms}
              checked={config.lockAfterMs === ms}
              disabled={disabled}
              disclosure={false}
              trailing={config.lockAfterMs === ms ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => {
                if (config.lockAfterMs === ms) return;
                void change(async () => {
                  await updateAppLockConfig({ lockAfterMs: ms });
                  return null;
                });
              }}
            >
              <Typography.Paragraph>{lockAfterLabel(ms, t)}</Typography.Paragraph>
            </SettingsRow>
          ))}
          <SettingsRow>
            <SettingsSwitch
              value={config.lockWithPhone}
              disabled={disabled}
              label={t("mobile.appLock.lockWithPhone")}
              dark={dark}
              onValueChange={(next) =>
                void change(async () => {
                  await updateAppLockConfig({ lockWithPhone: next });
                  return null;
                })
              }
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
