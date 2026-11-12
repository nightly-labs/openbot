// The setup of a two-step key for a Vault login, in three pages of the Server settings sheet after the
// login page: the ways to give the key (paste or type it, scan it with the camera, or read it from a
// screenshot), the camera, and a check of the first code on the site. The key stays in memory (`useTwoStepSetup`) until the login page takes it.
// The host gets it only when the user saves the login.

import { parseTwoStepKey, TWO_STEP_KEY_LIMIT } from "@openbot/contracts/two-step-code";
import { scanFromURLAsync } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import ImageIcon from "lucide-react-native/icons/image";
import ScanQrCode from "lucide-react-native/icons/scan-qr-code";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { PasteButton } from "@/features/servers/components/paste-button";
import { TwoStepCodePanel } from "@/features/servers/components/vault-two-step-code";
import { useDraftTwoStepCode, useTwoStepSetup } from "@/features/servers/model/vault-two-step";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The shape of a setup key, in the groups that sites show. A key is not translated. */
const EXAMPLE_KEY = "JBSW Y3DP EHPK 3PXP";

/** The icon and the text at the top of a setup page. */
function SetupIntro({ text }: { text: string }) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <View className="items-center gap-3 px-4">
      <View
        className="size-14 items-center justify-center rounded-2xl bg-grouped"
        style={{ borderCurve: "continuous" }}
      >
        <ShieldCheck size={28} strokeWidth={1.75} color={accent} />
      </View>
      <Typography.Paragraph align="center" className="text-text-secondary">
        {text}
      </Typography.Paragraph>
    </View>
  );
}

/** The page that shows while no setup is in progress, such as after the app reloads. */
function NoSetup() {
  const { t } = useText();
  return (
    <SettingsContent>
      <SettingsNote>{t("mobile.server.vault.twoStep.noSetup")}</SettingsNote>
    </SettingsContent>
  );
}

/** The QR code in a picture from the photo library. Null when the user closed the picker. */
async function readQrImage(): Promise<string | "none" | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const found = await scanFromURLAsync(asset.uri, ["qr"]);
  return found[0]?.data ?? "none";
}

/** Setup, step 1: the key of the site. */
export function ServerVaultTwoStepScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const formId = useTwoStepSetup((state) => state.formId);
  const site = useTwoStepSetup((state) => state.site);
  const keyText = useTwoStepSetup((state) => state.keyText);
  const setKeyText = useTwoStepSetup((state) => state.setKeyText);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  // Back from this page ends the setup. Done ends it first, so then this does nothing.
  const startedFor = useRef(formId);
  useEffect(
    () => () => {
      if (startedFor.current) useTwoStepSetup.getState().cancel(startedFor.current);
    },
    [],
  );
  if (!formId) return <NoSetup />;

  const check = () => router.push({ pathname: "/server-settings/vault-two-step-check", params: { serverId } });
  const next = () => {
    if (parseTwoStepKey(keyText)) {
      setError(null);
      check();
      return;
    }
    void haptics.notification("error");
    setError(t("mobile.server.vault.twoStep.keyInvalid"));
  };
  const chooseImage = async () => {
    setError(null);
    setReading(true);
    try {
      const text = await readQrImage();
      if (text === null) return;
      if (text !== "none" && parseTwoStepKey(text)) {
        setKeyText(text);
        void haptics.notification("success");
        check();
        return;
      }
      void haptics.notification("error");
      setError(t(text === "none" ? "mobile.server.vault.twoStep.noQrCode" : "mobile.server.vault.twoStep.qrNoKey"));
    } catch {
      void haptics.notification("error");
      setError(t("mobile.server.vault.twoStep.imageFailed"));
    } finally {
      setReading(false);
    }
  };

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.vault.twoStep.setupTitle") }} />
      <SheetSaveAction
        dirty={keyText.trim() !== ""}
        canSave
        pending={false}
        label={t("mobile.server.vault.twoStep.next")}
        onSave={next}
      />
      <SetupIntro text={t("mobile.server.vault.twoStep.setupIntro", { site })} />
      <SettingsSection>
        <SettingsRow
          leading={<ScanQrCode size={20} strokeWidth={1.8} color={muted} />}
          onPress={() => {
            setError(null);
            router.push({ pathname: "/server-settings/vault-two-step-scan", params: { serverId } });
          }}
        >
          <Typography.Paragraph>{t("mobile.server.vault.twoStep.scan")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          disabled={reading}
          leading={<ImageIcon size={20} strokeWidth={1.8} color={muted} />}
          supportingText={t("mobile.server.vault.twoStep.chooseImageHint")}
          onPress={() => void chooseImage()}
        >
          <Typography.Paragraph>{t("mobile.server.vault.twoStep.chooseImage")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SheetFormField
        label={t("mobile.server.vault.twoStep.keyLabel")}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={TWO_STEP_KEY_LIMIT}
        placeholder={EXAMPLE_KEY}
        value={keyText}
        error={error ?? undefined}
        hint={error ? undefined : t("mobile.server.vault.twoStep.keyHint")}
        returnKeyType="next"
        onSubmitEditing={next}
        trailing={
          <PasteButton
            disabled={false}
            onPaste={(value) => {
              setError(null);
              setKeyText(value);
            }}
          />
        }
        onChangeText={(value) => {
          setError(null);
          setKeyText(value);
        }}
      />
    </SettingsContent>
  );
}

/** Setup, step 3: the user enters the code on the site, so a wrong key shows before it is saved. */
export function ServerVaultTwoStepCheckScreen() {
  const { t } = useText();
  const formId = useTwoStepSetup((state) => state.formId);
  const site = useTwoStepSetup((state) => state.site);
  const keyText = useTwoStepSetup((state) => state.keyText);
  const finish = useTwoStepSetup((state) => state.finish);
  const draft = useDraftTwoStepCode(formId ? keyText : "");
  if (!formId || !draft.valid) return <NoSetup />;
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.vault.twoStep.checkTitle") }} />
      <SheetSaveAction
        dirty
        canSave
        pending={false}
        label={t("mobile.server.vault.twoStep.done")}
        onSave={() => {
          finish();
          void haptics.notification("success");
          // Back to the login page, past the key page. The scan step replaced itself with this page.
          router.dismiss(2);
        }}
      />
      <SetupIntro text={t("mobile.server.vault.twoStep.checkIntro", { site })} />
      <SettingsSection
        footer={draft.code ? t("mobile.server.vault.twoStep.checkHint", { count: draft.code.period }) : undefined}
      >
        <TwoStepCodePanel code={draft.code} now={draft.now} />
      </SettingsSection>
    </SettingsContent>
  );
}
