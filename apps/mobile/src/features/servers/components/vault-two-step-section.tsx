import type { VaultLoginSummary } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { useEffect } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { TwoStepCodeRow } from "@/features/servers/components/vault-two-step-code";
import { vaultLoginTitle } from "@/features/servers/model/vault-items";
import {
  useDraftTwoStepCode,
  useSecondClock,
  useServerVaultCodes,
  useTwoStepSetup,
} from "@/features/servers/model/vault-two-step";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

/** The site of a login for the setup text: its host name, or "the site" while the field is empty. */
function twoStepSite(website: string, theSite: string): string {
  return website.trim() ? vaultLoginTitle({ website }) : theSite;
}

/**
 * The two-step code of a login page (`vault-v3`). Off: Set up opens the setup steps. On: the live
 * code, which the host makes from the saved key, or the phone from a key that is not saved yet, and
 * Remove. The change goes to the host with the login when the user saves it.
 */
export function VaultTwoStepSection({
  formId,
  serverId,
  host,
  website,
  saved,
  twoStepKey,
  disabled,
  onChange,
}: {
  formId: string;
  serverId: string;
  host: string;
  website: string;
  saved: VaultLoginSummary | undefined;
  /** The draft value: null keeps the saved key, "" removes it, other text is a new key. */
  twoStepKey: string | null;
  disabled: boolean;
  onChange: (twoStepKey: string | null) => void;
}) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const savedKey = saved?.hasTwoStep === true;
  const keepsSaved = twoStepKey === null && savedKey;
  const newKey = twoStepKey !== null && twoStepKey !== "";
  const on = keepsSaved || newKey;
  const savedCodes = useServerVaultCodes(serverId, keepsSaved);
  const draft = useDraftTwoStepCode(newKey ? twoStepKey : "");
  // A new key has the clock of its draft code; a saved key needs its own.
  const savedNow = useSecondClock(keepsSaved);
  const now = newKey ? draft.now : savedNow;
  const code = newKey ? draft.code : saved && keepsSaved ? savedCodes.code(saved.id) : undefined;
  const site = twoStepSite(website, t("mobile.server.vault.twoStep.theSite"));

  // The setup steps give back the key when the user selects Done on the check step.
  const finished = useTwoStepSetup((state) => state.finished);
  useEffect(() => {
    if (finished?.formId !== formId) return;
    const key = useTwoStepSetup.getState().take(formId);
    if (key) onChange(key);
  }, [finished, formId, onChange]);
  useEffect(() => () => useTwoStepSetup.getState().clear(formId), [formId]);

  const setUp = () => {
    useTwoStepSetup.getState().start(formId, site);
    router.push({ pathname: "/server-settings/vault-two-step", params: { serverId } });
  };
  const remove = () => onChange(savedKey ? "" : null);

  const footer = newKey
    ? t("mobile.server.vault.twoStep.unsavedKey")
    : twoStepKey === "" && savedKey
      ? t("mobile.server.vault.twoStep.unsavedRemove")
      : on
        ? t("mobile.server.vault.twoStep.onFooter", { host })
        : t("mobile.server.vault.twoStep.offFooter");

  if (!on)
    return (
      <SettingsSection title={t("mobile.server.vault.twoStep.title")} footer={footer}>
        <SettingsRow
          disabled={disabled}
          onPress={setUp}
          leading={
            <View className="size-8 items-center justify-center rounded-lg bg-control">
              <ShieldCheck size={18} strokeWidth={1.8} color={muted} />
            </View>
          }
          trailing={
            <Typography.Paragraph className="text-accent-text">
              {t("mobile.server.vault.twoStep.setUp")}
            </Typography.Paragraph>
          }
          disclosure={false}
        >
          <Typography.Paragraph>{t("mobile.server.vault.twoStep.off")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );

  return (
    <SettingsSection title={t("mobile.server.vault.twoStep.title")} footer={footer}>
      <TwoStepCodeRow
        code={code}
        now={now}
        caption={
          !code && keepsSaved && savedCodes.query.isError ? t("mobile.server.vault.twoStep.codeFailed") : undefined
        }
      />
      <SettingsRow disclosure={false} disabled={disabled} onPress={remove}>
        <Typography.Paragraph className="text-danger-text">
          {t("mobile.server.vault.twoStep.remove")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
