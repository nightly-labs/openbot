import { AVATAR_COLOR_CHOICES } from "@openbot/brand/bloub-avatar";
import {
  isServerAppearanceColor,
  SERVER_APPEARANCE_SHAPES,
  type ServerAppearance,
  type ServerAppearanceShape,
} from "@openbot/contracts/team-protocol/host-appearance-v1";
import { Image } from "expo-image";
import { Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import {
  AppearanceSection,
  avatarColorChoiceLabel,
  ChoiceCell,
  HeadingAction,
} from "@/features/agents/components/agent-appearance-picker";
import { useServerPlush } from "@/features/servers/model/server-plush";
import { useLockedAction } from "@/features/servers/model/use-locked-action";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

/** Columns of each grid, so that the rows are full: 10 shapes, and 17 colours with Automatic. */
const SHAPE_COLUMNS = 5;
const COLOR_COLUMNS = 9;
const SHAPE_SIZE = 40;

/**
 * The shape and colour of the plush that the server shows with no logo, for an owner or admin of a
 * connected host that serves `host-appearance-v1`. Each choice saves at once; the host tells every
 * member.
 */
export function ServerAppearancePicker({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { setServerAppearance } = useMobileWorkspace();
  const { busy, error, perform } = useLockedAction();
  // The choice that is being saved, so it shows at once. Undefined shows the saved one.
  const [pending, setPending] = useState<ServerAppearance | null | undefined>();
  const shown = pending === undefined ? (server.appearance ?? null) : pending;

  function save(choice: ServerAppearance | null): void {
    // The squircle in the automatic colour is the automatic look, so it is saved as null, as on desktop.
    const next = choice?.shape === "squircle" && choice.color === null ? null : choice;
    setPending(next);
    void perform(
      () => setServerAppearance(server.id, next),
      (caught) => errorMessage(caught, t("mobile.server.settings.appearanceSaveFailed")),
    ).finally(() => setPending(undefined));
  }

  // A colour with no shape yet takes the first shape, which is the automatic one.
  const selectShape = (shape: ServerAppearanceShape) => save({ shape, color: shown?.color ?? null });
  const selectColor = (color: ServerAppearance["color"]) =>
    save({ shape: shown?.shape ?? SERVER_APPEARANCE_SHAPES[0], color });

  return (
    <AppearanceSection
      title={t("mobile.server.settings.appearance")}
      plain
      actions={
        shown ? (
          <HeadingAction
            label={t("mobile.server.settings.appearanceReset")}
            icon="reset"
            disabled={busy}
            onPress={() => save(null)}
          />
        ) : null
      }
    >
      <View className="gap-5">
        <AppearanceSection title={t("mobile.server.settings.appearanceShape")}>
          <View
            className="flex-row flex-wrap"
            accessibilityRole="radiogroup"
            accessibilityLabel={t("mobile.server.settings.appearanceShape")}
          >
            {SERVER_APPEARANCE_SHAPES.map((shape, index) => (
              <ChoiceCell
                key={shape}
                columns={SHAPE_COLUMNS}
                label={t("mobile.server.settings.appearanceShapeOption", { number: index + 1 })}
                checked={shown?.shape === shape}
                disabled={busy}
                onPress={() => selectShape(shape)}
              >
                <ShapeThumbnail serverId={server.id} shape={shape} color={shown?.color ?? null} />
              </ChoiceCell>
            ))}
          </View>
        </AppearanceSection>
        <AppearanceSection title={t("mobile.server.settings.appearanceColor")}>
          <View
            className="flex-row flex-wrap"
            accessibilityRole="radiogroup"
            accessibilityLabel={t("mobile.server.settings.appearanceColor")}
          >
            <ChoiceCell
              columns={COLOR_COLUMNS}
              label={t("mobile.server.settings.appearanceAutomatic")}
              checked={(shown?.color ?? null) === null}
              disabled={busy}
              onPress={() => selectColor(null)}
            >
              <View className="size-6 items-center justify-center rounded-full border border-grouped-border">
                <Typography type="body-xs" className="font-semibold text-foreground">
                  {t("mobile.agent.appearance.automaticShort")}
                </Typography>
              </View>
            </ChoiceCell>
            {AVATAR_COLOR_CHOICES.map((choice) => {
              // The host saves a colour as lower-case `#rrggbb`.
              const color = choice.swatch.toLowerCase();
              if (!isServerAppearanceColor(color)) return null;
              return (
                <ChoiceCell
                  key={choice.swatch}
                  columns={COLOR_COLUMNS}
                  label={t(avatarColorChoiceLabel(choice))}
                  checked={shown?.color === color}
                  disabled={busy}
                  onPress={() => selectColor(color)}
                >
                  <View className="size-6 rounded-full" style={{ backgroundColor: choice.swatch }} />
                </ChoiceCell>
              );
            })}
          </View>
        </AppearanceSection>
        {error ? (
          <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text">
            {error}
          </Typography.Paragraph>
        ) : null}
      </View>
    </AppearanceSection>
  );
}

/** One shape in the colour that the server shows. */
function ShapeThumbnail({
  serverId,
  shape,
  color,
}: {
  serverId: string;
  shape: ServerAppearanceShape;
  color: ServerAppearance["color"];
}) {
  const { uri } = useServerPlush(serverId, { shape, color }, SHAPE_SIZE, 1);
  return (
    <View style={{ height: SHAPE_SIZE, width: SHAPE_SIZE }}>
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="contain"
          recyclingKey={uri}
          style={{ height: SHAPE_SIZE, width: SHAPE_SIZE }}
        />
      ) : null}
    </View>
  );
}
