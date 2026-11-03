import {
  AVATAR_COLOR_CHOICES,
  type AvatarColorChoice,
  type AvatarColorPresetId,
  avatarHeadColor,
  isAvatarColorChoice,
} from "@openbot/brand/bloub-avatar";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Shuffle from "lucide-react-native/icons/shuffle";
import { memo, type ReactNode, useCallback, useState } from "react";
import { View } from "react-native";
import { AgentColorGlow } from "@/features/agents/components/agent-color-glow";
import { AvatarThumbnail, BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { createAvatarCandidates } from "@/features/agents/model/avatar-candidates";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import type { AgentPhotoProps } from "./agent-photo";

const PREVIEW_SIZE = 144;
// Centred on the avatar. In a sheet with a clear header it reaches up behind the header's blur.
const GLOW_HEIGHT = 340;

export const HUE_LABELS = {
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

const PRESET_LABELS = {
  pink: "mobile.agent.appearance.hue.pink",
  sky: "mobile.agent.appearance.hue.sky",
  navy: "mobile.agent.appearance.hue.navy",
  wine: "mobile.agent.appearance.hue.wine",
  brown: "mobile.agent.appearance.hue.brown",
  sand: "mobile.agent.appearance.hue.sand",
  grey: "mobile.agent.appearance.hue.grey",
} as const satisfies Record<AvatarColorPresetId, MobileTextKey>;

/** The name of a colour in an agent colour picker. */
export function avatarColorChoiceLabel(choice: AvatarColorChoice): MobileTextKey {
  return choice.kind === "hue" ? HUE_LABELS[choice.hue] : PRESET_LABELS[choice.preset];
}

/** The `avatarHue` and `avatarColor` that a colour choice saves. Both null is the automatic colour. */
export interface AgentColorValue {
  hue: AvatarHue | null;
  color: AvatarColor | null;
}

interface AgentAppearancePickerProps extends AgentPhotoProps {
  seed: string;
  hue: AvatarHue | null;
  /** The agent's `avatarColor`. It wins over `hue`. */
  color: AvatarColor | null;
  name: string;
  nameField: ReactNode;
  photoField?: ReactNode;
  showFaces?: boolean;
  /** A glow in the agent colour behind the preview. */
  colorGlow?: boolean;
  disabled: boolean;
  onSeedChange: (seed: string) => void;
  onColorChange: (value: AgentColorValue) => void;
}

export function AgentAppearancePicker({
  agentId,
  serverId,
  imageUrl,
  seed,
  hue,
  color,
  name,
  nameField,
  photoField,
  showFaces = true,
  colorGlow = false,
  disabled,
  onSeedChange,
  onColorChange,
}: AgentAppearancePickerProps) {
  const { t } = useText();
  const [candidates, setCandidates] = useState(() => createAvatarCandidates(seed));
  const shuffle = useCallback(() => setCandidates((current) => createAvatarCandidates(seed, current)), [seed]);
  const targetColor = avatarHeadColor(seed, hue, color);

  return (
    <View className="gap-4">
      <View
        className="items-center gap-2"
        accessible
        accessibilityLabel={t("mobile.agent.appearance.preview", {
          name: name.trim() || t("mobile.agent.appearance.newAgent"),
        })}
      >
        {colorGlow ? <AgentColorGlow color={targetColor} centerY={PREVIEW_SIZE / 2} height={GLOW_HEIGHT} /> : null}
        <BloubAvatarPreview
          agentId={agentId}
          serverId={serverId}
          imageUrl={imageUrl}
          seed={seed}
          hue={hue}
          color={color}
          size={PREVIEW_SIZE}
          transition="pop"
        />
      </View>
      {nameField}
      {showFaces ? (
        <>
          <AvatarFaceOptions
            seeds={candidates.seeds}
            seed={seed}
            hue={hue}
            color={color}
            disabled={disabled}
            onSeedChange={onSeedChange}
            onShuffle={shuffle}
            photoField={photoField}
          />
          <AvatarColorOptions hue={hue} color={color} disabled={disabled} onColorChange={onColorChange} />
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
  color,
  disabled,
  onSeedChange,
  onShuffle,
  photoField,
}: {
  seeds: string[];
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
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
          onPress={() => {
            void haptics.selection();
            onSeedChange(candidate);
          }}
        >
          {/* Android redraws each SVG in software on every frame of a colour fade, twelve at once here. */}
          <AvatarThumbnail seed={candidate} hue={hue} color={color} size={36} animateColor={!isAndroid} />
        </Button>
      ))}
      <Button
        isIconOnly
        variant="ghost"
        accessibilityLabel={t("mobile.agent.appearance.moreFaces")}
        isDisabled={disabled}
        onPress={() => {
          void haptics.selection();
          onShuffle();
        }}
      >
        <ShuffleIcon />
      </Button>
      {photoField}
    </View>
  );
});

const AvatarColorOptions = memo(function AvatarColorOptions({
  hue,
  color,
  disabled,
  onColorChange,
}: {
  hue: AvatarHue | null;
  color: AvatarColor | null;
  disabled: boolean;
  onColorChange: (value: AgentColorValue) => void;
}) {
  const automatic = hue === null && color === null;
  const { t } = useText();
  return (
    <View
      className="mt-4 flex-row flex-wrap items-center justify-center gap-2"
      accessibilityRole="radiogroup"
      accessibilityLabel={t("mobile.agent.appearance.color")}
    >
      {AVATAR_COLOR_CHOICES.map((choice) => {
        const checked = isAvatarColorChoice(choice, hue, color);
        return (
          <Button
            key={choice.swatch}
            isIconOnly
            variant={checked ? "secondary" : "ghost"}
            accessibilityRole="radio"
            accessibilityLabel={t(avatarColorChoiceLabel(choice))}
            accessibilityState={{ checked, disabled }}
            isDisabled={disabled}
            onPress={() => {
              void haptics.selection();
              onColorChange({ hue: choice.hue, color: choice.color });
            }}
          >
            <View className="size-6 rounded-full" style={{ backgroundColor: choice.swatch }} />
          </Button>
        );
      })}
      <Button
        isIconOnly
        variant={automatic ? "secondary" : "ghost"}
        accessibilityRole="radio"
        accessibilityLabel={t("mobile.agent.appearance.automatic")}
        accessibilityState={{ checked: automatic, disabled }}
        isDisabled={disabled}
        onPress={() => {
          void haptics.selection();
          onColorChange({ hue: null, color: null });
        }}
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
