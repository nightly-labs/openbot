import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import ImagePlus from "lucide-react-native/icons/image-plus";
import Trash2 from "lucide-react-native/icons/trash";
import { useState } from "react";
import { Alert, View } from "react-native";
import { ServerAppearancePicker } from "@/features/servers/components/server-appearance-picker";
import { SERVER_AVATAR_CORNER_RATIO, ServerAvatar } from "@/features/servers/components/server-avatar";
import { useLockedAction } from "@/features/servers/model/use-locked-action";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useLiveServerRecovery } from "@/features/workspace/context/server-recovery-countdown";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { type AvatarPhoto, pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

const PREVIEW_SIZE = 120;

export function ServerLogoScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers } = useMobileWorkspace();
  const server = useLiveServerRecovery(servers.find((item) => item.id === serverId));
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return <ServerLogoEditor server={server} />;
}

function ServerLogoEditor({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { canEditServerIdentity, canEditServerAppearance, updateServerIdentity } = useMobileWorkspace();
  const canEditLogo = canEditServerIdentity(server.id);
  const { busy, error, perform } = useLockedAction();
  const [preview, setPreview] = useState<AvatarPhoto | null | undefined>();
  const hasLogo = server.logoKey !== null;

  useDiscardGuard(busy, { busy: () => busy, warn: true });

  async function saveLogo(logo: AvatarPhoto | null): Promise<void> {
    setPreview(logo);
    try {
      await updateServerIdentity(server.id, {
        logo: logo ? { mimeType: logo.mimeType, bytes: logo.bytes } : null,
      });
    } finally {
      setPreview(undefined);
    }
  }

  const saveFailure = (caught: unknown) => errorMessage(caught, t("mobile.server.settings.identitySaveFailed"));

  function chooseLogo(): void {
    void haptics.impact("soft");
    let picked = false;
    void perform(
      async (cancel) => {
        const photo = await pickAvatarPhoto({ pathname: "/server-settings/crop-logo" }, SERVER_AVATAR_CORNER_RATIO);
        if (!photo) {
          cancel();
          return;
        }
        picked = true;
        await saveLogo(photo);
      },
      (caught) => (picked ? saveFailure(caught) : errorMessage(caught, t("mobile.shared.photo.openFailed"))),
    );
  }

  function removeLogo(): void {
    Alert.alert(t("mobile.server.settings.removeLogo"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.server.settings.removeLogo"),
        style: "destructive",
        onPress: () => void perform(() => saveLogo(null), saveFailure),
      },
    ]);
  }

  return (
    <SettingsContent>
      <View className="items-center py-2">
        <ServerAvatar
          server={server}
          size={PREVIEW_SIZE}
          showStatus={false}
          logoUri={preview === undefined ? undefined : (preview?.uri ?? null)}
        />
      </View>
      {canEditLogo ? (
        <SettingsSection footer={error}>
          <SettingsRow leading={<RowIcon icon={ImagePlus} />} disclosure={false} disabled={busy} onPress={chooseLogo}>
            <Typography.Paragraph>
              {t(hasLogo ? "mobile.server.settings.changeLogo" : "mobile.server.settings.addLogo")}
            </Typography.Paragraph>
          </SettingsRow>
          {hasLogo ? (
            <SettingsRow
              leading={<RowIcon icon={Trash2} tone="danger" />}
              disclosure={false}
              disabled={busy}
              onPress={removeLogo}
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.settings.removeLogo")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {canEditServerAppearance(server.id) && !hasLogo ? <ServerAppearancePicker server={server} /> : null}
    </SettingsContent>
  );
}
