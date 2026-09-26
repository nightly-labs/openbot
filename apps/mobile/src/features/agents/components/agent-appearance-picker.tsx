import { AVATAR_HUE_CHOICES, avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Shuffle } from "lucide-react-native";
import { memo, type ReactNode, useCallback, useState } from "react";
import { View } from "react-native";
import { AvatarThumbnail, BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { createAvatarCandidates } from "@/features/agents/model/avatar-candidates";
import { useText } from "@/shared/lib/text";
import type { AgentPhotoProps } from "./agent-photo";

const HUE_LABELS = {
  0: "mobile.agent.appearance.hue.red",
  30: "mobile.agent.appearance.hue.orange",
  55: "mobile.agent.appearance.hue.yellow",
  100: "mobile.agent.appearance.hue.lime",
  150: "mobile.agent.appearance.hue.green",
  185: "mobile.agent.appearance.hue.cyan",
  215: "mobile.agent.appearance.hue.blue",
  245: "mobile.agent.appearance.hue.indigo",
  280: "mobile.agent.appearance.hue.violet",
  320: "mobile.agent.appearance.hue.magenta",
} as const satisfies Record<AvatarHue, MobileTextKey>;

interface AgentAppearancePickerProps extends AgentPhotoProps {
  seed: string;
  hue: AvatarHue | null;
  name: string;
  nameField: ReactNode;
  photoField?: ReactNode;
  showFaces?: boolean;
  disabled: boolean;
  onSeedChange: (seed: string) => void;
  onHueChange: (hue: AvatarHue | null) => void;
}

export function AgentAppearancePicker({
  agentId,
  serverId,
  imageUrl,
  seed,
  hue,
  name,
  nameField,
  photoField,
  showFaces = true,
  disabled,
  onSeedChange,
  onHueChange,
}: AgentAppearancePickerProps) {
  const { t } = useText();
  const [candidates, setCandidates] = useState(() => createAvatarCandidates(seed));
  const shuffle = useCallback(() => setCandidates((current) => createAvatarCandidates(seed, current)), [seed]);

  return (
    <View className="gap-4">
      <View
        className="items-center gap-2"
        accessible
        accessibilityLabel={t("mobile.agent.appearance.preview", {
          name: name.trim() || t("mobile.agent.appearance.newAgent"),
        })}
      >
        <BloubAvatarPreview
          agentId={agentId}
          serverId={serverId}
          imageUrl={imageUrl}
          seed={seed}
          hue={hue}
          size={144}
        />
      </View>
      {nameField}
      {showFaces ? (
        <>
          <AvatarFaceOptions
            seeds={candidates.seeds}
            seed={seed}
            hue={hue}
            disabled={disabled}
            onSeedChange={onSeedChange}
            onShuffle={shuffle}
            photoField={photoField}
          />
          <AvatarHueOptions hue={hue} disabled={disabled} onHueChange={onHueChange} />
        </>
      ) : photoField ? (
        <View className="flex-row flex-wrap items-center justify-center gap-2">{photoField}</View>
      ) : null}
    </View>
  );
}

// Memoized so typing in the name field does not re-render every choice.
const AvatarFaceOptions = memo(function AvatarFaceOptions({
  seeds,
  seed,
  hue,
  disabled,
  onSeedChange,
  onShuffle,
  photoField,
}: {
  seeds: string[];
  seed: string;
  hue: AvatarHue | null;
  disabled: boolean;
  onSeedChange: (seed: string) => void;
  onShuffle: () => void;
  photoField?: ReactNode;
}) {
  const { t } = useText();
  return (
    <View
      className="mt-4 flex-row flex-wrap items-center justify-center gap-2"
      accessibilityRole="radiogroup"
      accessibilityLabel={t("mobile.agent.appearance.faces")}
    >
      {seeds.map((candidate, index) => (
        <Button
          key={candidate}
          isIconOnly
          variant={seed === candidate ? "secondary" : "ghost"}
          accessibilityRole="radio"
          accessibilityLabel={t("mobile.agent.appearance.face", { index: index + 1 })}
          accessibilityState={{ checked: seed === candidate, disabled }}
          isDisabled={disabled}
          onPress={() => onSeedChange(candidate)}
        >
          <AvatarThumbnail seed={candidate} hue={hue} size={36} />
        </Button>
      ))}
      <Button
        isIconOnly
        variant="ghost"
        accessibilityLabel={t("mobile.agent.appearance.moreFaces")}
        isDisabled={disabled}
        onPress={onShuffle}
      >
        <ShuffleIcon />
      </Button>
      {photoField}
    </View>
  );
});

const AvatarHueOptions = memo(function AvatarHueOptions({
  hue,
  disabled,
  onHueChange,
}: {
  hue: AvatarHue | null;
  disabled: boolean;
  onHueChange: (hue: AvatarHue | null) => void;
}) {
  const { t } = useText();
  return (
    <View
      className="mt-4 flex-row flex-wrap items-center justify-center gap-2"
      accessibilityRole="radiogroup"
      accessibilityLabel={t("mobile.agent.appearance.color")}
    >
      {AVATAR_HUE_CHOICES.map((option) => {
        // A stored hue 100 or 280 shows as its same-color choice.
        const checked = hue !== null && avatarHueSwatch(hue) === avatarHueSwatch(option.hue);
        return (
          <Button
            key={option.hue}
            isIconOnly
            variant={checked ? "secondary" : "ghost"}
            accessibilityRole="radio"
            accessibilityLabel={t(HUE_LABELS[option.hue])}
            accessibilityState={{ checked, disabled }}
            isDisabled={disabled}
            onPress={() => onHueChange(option.hue)}
          >
            <View className="size-6 rounded-full" style={{ backgroundColor: avatarHueSwatch(option.hue) }} />
          </Button>
        );
      })}
      <Button
        isIconOnly
        variant={hue === null ? "secondary" : "ghost"}
        accessibilityRole="radio"
        accessibilityLabel={t("mobile.agent.appearance.automatic")}
        accessibilityState={{ checked: hue === null, disabled }}
        isDisabled={disabled}
        onPress={() => onHueChange(null)}
      >
        <Typography type="body-sm" className="font-semibold text-foreground">
          {t("mobile.agent.appearance.automaticShort")}
        </Typography>
      </Button>
    </View>
  );
});

function ShuffleIcon() {
  const foreground = useThemeColor("foreground");
  return <Shuffle color={foreground} size={20} />;
}
