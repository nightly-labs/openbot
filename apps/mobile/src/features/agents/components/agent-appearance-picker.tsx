import type { ExpressionId } from "@norbert_bodziony/bloub";
import {
  AVATAR_COLOR_CHOICES,
  AVATAR_EXPRESSIONS,
  type AvatarColorChoice,
  type AvatarColorPresetId,
  type AvatarStyle,
  avatarDefaultSeed,
  avatarHeadColor,
  avatarHueForColor,
  avatarStyleForSeed,
  bloubAvatarProfile,
  isAvatarColorChoice,
  SUPPORTED_AVATAR_SILHOUETTES,
  type SupportedAvatarSilhouetteId,
} from "@openbot/brand/bloub-avatar";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Shuffle from "lucide-react-native/icons/shuffle";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { AgentColorGlow } from "@/features/agents/components/agent-color-glow";
import { AvatarThumbnail, BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { UsageSegments } from "@/features/agents/components/usage-segments";
import { type AvatarFace, avatarSeedForStyledFace, randomAvatarFace } from "@/features/agents/model/avatar-candidates";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import type { AgentPhotoProps } from "./agent-photo";

const PREVIEW_SIZE = 144;
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

export function avatarColorChoiceLabel(choice: AvatarColorChoice): MobileTextKey {
  return choice.kind === "hue" ? HUE_LABELS[choice.hue] : PRESET_LABELS[choice.preset];
}

export interface AgentColorValue {
  hue: AvatarHue | null;
  color: AvatarColor | null;
}

interface AgentAppearancePickerProps extends AgentPhotoProps {
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  name: string;
  nameField: ReactNode;
  photoField?: ReactNode;
  showFaces?: boolean;
  colorGlow?: boolean;
  disabled: boolean;
  onSeedChange: (seed: string) => void;
  onColorChange: (value: AgentColorValue) => void;
}

const SHAPE_COLUMNS = 5;
const EYES_COLUMNS = 8;
const COLOR_COLUMNS = 9;

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
  const [firstSeed] = useState(seed);
  const faceKey = agentId ?? firstSeed;
  const targetColor = avatarHeadColor(seed, hue, color);
  const style = avatarStyleForSeed(seed);
  const { shape, expression } = bloubAvatarProfile(seed, null);
  const resetSeed = useMemo(() => avatarDefaultSeed(faceKey, style), [faceKey, style]);

  const selectSeed = useCallback(
    (next: string) => {
      if (next === seed) return;
      const nextColor = avatarHeadColor(next, null);
      if (color === null && hue === null && nextColor !== targetColor) {
        onColorChange({ hue: avatarHueForColor(targetColor), color: null });
      } else if (color === null && next === faceKey && hue === avatarHueForColor(nextColor)) {
        onColorChange({ hue: null, color: null });
      }
      onSeedChange(next);
    },
    [color, faceKey, hue, onColorChange, onSeedChange, seed, targetColor],
  );
  const selectFace = useCallback(
    (change: Partial<AvatarFace> & { style?: AvatarStyle }) => {
      const face = { shape: change.shape ?? shape, expression: change.expression ?? expression };
      selectSeed(avatarSeedForStyledFace(faceKey, face, change.style ?? style));
    },
    [expression, faceKey, selectSeed, shape, style],
  );
  const selectStyle = useCallback((next: AvatarStyle) => selectFace({ style: next }), [selectFace]);
  const resetFace = useCallback(() => selectSeed(resetSeed), [resetSeed, selectSeed]);
  const shuffleFace = useCallback(
    () => selectFace(randomAvatarFace({ shape, expression })),
    [expression, selectFace, shape],
  );

  return (
    <View className="gap-5">
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
      {photoField ? (
        <AppearanceSection title={t("mobile.agent.appearance.photo")}>
          <View className="flex-row flex-wrap items-center justify-center gap-2 p-2">{photoField}</View>
        </AppearanceSection>
      ) : null}
      {showFaces ? (
        <>
          <AvatarStyleOptions style={style} disabled={disabled} onStyleChange={selectStyle} />
          <AvatarShapeOptions
            faceKey={faceKey}
            style={style}
            shape={shape}
            expression={expression}
            hue={hue}
            color={color}
            shownColor={targetColor}
            disabled={disabled}
            onSelect={selectFace}
            canReset={seed !== resetSeed}
            onReset={resetFace}
            onShuffle={shuffleFace}
          />
          <AvatarEyesOptions
            faceKey={faceKey}
            style={style}
            shape={shape}
            expression={expression}
            hue={hue}
            color={color}
            shownColor={targetColor}
            disabled={disabled}
            onSelect={selectFace}
          />
          <AvatarColorOptions hue={hue} color={color} disabled={disabled} onColorChange={onColorChange} />
        </>
      ) : null}
    </View>
  );
}

export function AppearanceSection({
  title,
  actions,
  plain = false,
  children,
}: {
  title: string;
  actions?: ReactNode;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="min-h-8 flex-row items-center justify-between gap-2 px-4">
        <Typography type="body-xs" className="text-grouped-secondary">
          {title}
        </Typography>
        {actions ? <View className="flex-row items-center">{actions}</View> : null}
      </View>
      {plain ? children : <View className="overflow-hidden rounded-grouped bg-grouped p-2">{children}</View>}
    </View>
  );
}

export function HeadingAction({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: "reset" | "shuffle";
  disabled: boolean;
  onPress: () => void;
}) {
  const muted = useThemeColor("muted");
  const Icon = icon === "reset" ? RotateCcw : Shuffle;
  return (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      accessibilityLabel={label}
      isDisabled={disabled}
      onPress={() => {
        void haptics.selection();
        onPress();
      }}
    >
      <Icon color={muted} size={18} />
    </Button>
  );
}

const AvatarStyleOptions = memo(function AvatarStyleOptions({
  style,
  disabled,
  onStyleChange,
}: {
  style: AvatarStyle;
  disabled: boolean;
  onStyleChange: (style: AvatarStyle) => void;
}) {
  const { t } = useText();
  const options = useMemo(
    () => [
      { value: "plush" as const, label: t("mobile.agent.appearance.stylePlush") },
      { value: "flat" as const, label: t("mobile.agent.appearance.styleFlat") },
    ],
    [t],
  );
  return (
    <AppearanceSection title={t("mobile.agent.appearance.styleHeading")} plain>
      <UsageSegments
        options={options}
        value={style}
        disabled={disabled}
        accessibilityLabel={t("mobile.agent.appearance.style")}
        onChange={onStyleChange}
      />
    </AppearanceSection>
  );
});

export function ChoiceCell({
  columns,
  label,
  checked,
  disabled,
  onPress,
  children,
}: {
  columns: number;
  label: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      style={{ width: `${100 / columns}%` as const }}
      className="aspect-square p-0.5"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => {
        if (checked) return;
        void haptics.selection();
        onPress();
      }}
    >
      {({ pressed }) => (
        <View
          className={`flex-1 items-center justify-center rounded-xl ${checked ? "bg-foreground/10" : ""}`}
          style={{ opacity: pressed && !checked ? 0.6 : disabled ? 0.5 : 1 }}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
}

interface FaceOptionsProps {
  faceKey: string;
  style: AvatarStyle;
  shape: SupportedAvatarSilhouetteId;
  expression: ExpressionId;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  shownColor: string;
  disabled: boolean;
  onSelect: (face: Partial<AvatarFace>) => void;
}

function choiceHue(hue: AvatarHue | null, color: AvatarColor | null, shownColor: string): AvatarHue | null {
  return color === null && hue === null ? avatarHueForColor(shownColor) : hue;
}

const AvatarShapeOptions = memo(function AvatarShapeOptions({
  faceKey,
  style,
  shape,
  expression,
  hue,
  color,
  shownColor,
  disabled,
  onSelect,
  canReset,
  onReset,
  onShuffle,
}: FaceOptionsProps & { canReset: boolean; onReset: () => void; onShuffle: () => void }) {
  const { t } = useText();
  const actions = (
    <>
      {canReset ? (
        <HeadingAction
          label={t("mobile.agent.appearance.resetFace")}
          disabled={disabled}
          icon="reset"
          onPress={onReset}
        />
      ) : null}
      <HeadingAction
        label={t("mobile.agent.appearance.randomFace")}
        disabled={disabled}
        icon="shuffle"
        onPress={onShuffle}
      />
    </>
  );
  const seeds = useMemo(
    () =>
      SUPPORTED_AVATAR_SILHOUETTES.map((option) =>
        avatarSeedForStyledFace(faceKey, { shape: option, expression }, style),
      ),
    [expression, faceKey, style],
  );
  const thumbnailHue = choiceHue(hue, color, shownColor);
  return (
    <AppearanceSection title={t("mobile.agent.appearance.shape")} actions={actions}>
      <View
        className="flex-row flex-wrap"
        accessibilityRole="radiogroup"
        accessibilityLabel={t("mobile.agent.appearance.shape")}
      >
        {SUPPORTED_AVATAR_SILHOUETTES.map((option, index) => (
          <ChoiceCell
            key={option}
            columns={SHAPE_COLUMNS}
            label={t("mobile.agent.appearance.shapeOption", { number: index + 1 })}
            checked={option === shape}
            disabled={disabled}
            onPress={() => onSelect({ shape: option })}
          >
            <AvatarThumbnail
              seed={seeds[index] ?? faceKey}
              hue={thumbnailHue}
              color={color}
              size={40}
              animateColor={!isAndroid}
            />
          </ChoiceCell>
        ))}
      </View>
    </AppearanceSection>
  );
});

const AvatarEyesOptions = memo(function AvatarEyesOptions({
  faceKey,
  style,
  shape,
  expression,
  hue,
  color,
  shownColor,
  disabled,
  onSelect,
}: FaceOptionsProps) {
  const { t } = useText();
  const seeds = useMemo(
    () => AVATAR_EXPRESSIONS.map((option) => avatarSeedForStyledFace(faceKey, { shape, expression: option }, style)),
    [faceKey, shape, style],
  );
  const thumbnailHue = choiceHue(hue, color, shownColor);
  return (
    <AppearanceSection title={t("mobile.agent.appearance.eyes")}>
      <View
        className="flex-row flex-wrap"
        accessibilityRole="radiogroup"
        accessibilityLabel={t("mobile.agent.appearance.eyes")}
      >
        {AVATAR_EXPRESSIONS.map((option, index) => (
          <ChoiceCell
            key={option}
            columns={EYES_COLUMNS}
            label={t("mobile.agent.appearance.eyesOption", { number: index + 1 })}
            checked={option === expression}
            disabled={disabled}
            onPress={() => onSelect({ expression: option })}
          >
            <AvatarThumbnail
              seed={seeds[index] ?? faceKey}
              hue={thumbnailHue}
              color={color}
              size={30}
              animateColor={!isAndroid}
            />
          </ChoiceCell>
        ))}
      </View>
    </AppearanceSection>
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
    <AppearanceSection title={t("mobile.agent.appearance.colorHeading")}>
      <View
        className="flex-row flex-wrap"
        accessibilityRole="radiogroup"
        accessibilityLabel={t("mobile.agent.appearance.color")}
      >
        {AVATAR_COLOR_CHOICES.map((choice) => {
          const checked = isAvatarColorChoice(choice, hue, color);
          return (
            <ChoiceCell
              key={choice.swatch}
              columns={COLOR_COLUMNS}
              label={t(avatarColorChoiceLabel(choice))}
              checked={checked}
              disabled={disabled}
              onPress={() => onColorChange({ hue: choice.hue, color: choice.color })}
            >
              <View className="size-6 rounded-full" style={{ backgroundColor: choice.swatch }} />
            </ChoiceCell>
          );
        })}
        <ChoiceCell
          columns={COLOR_COLUMNS}
          label={t("mobile.agent.appearance.automatic")}
          checked={automatic}
          disabled={disabled}
          onPress={() => onColorChange({ hue: null, color: null })}
        >
          <View className="size-6 items-center justify-center rounded-full border border-grouped-border">
            <Typography type="body-xs" className="font-semibold text-foreground">
              {t("mobile.agent.appearance.automaticShort")}
            </Typography>
          </View>
        </ChoiceCell>
      </View>
    </AppearanceSection>
  );
});
