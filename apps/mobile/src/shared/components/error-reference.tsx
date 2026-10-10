import { Typography } from "heroui-native";

import { useText } from "@/shared/lib/text";

/**
 * The code of a failure, such as `signal/host_busy`, as muted text that a user can select and copy.
 * Renders nothing when the failure has no code.
 */
export function ErrorReference({
  reference,
  align,
  numberOfLines,
}: {
  reference: string | null | undefined;
  align?: "center";
  numberOfLines?: number;
}) {
  const { t } = useText();
  if (!reference) return null;
  return (
    <Typography.Paragraph
      type="body-xs"
      align={align}
      className="text-muted"
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={1.2}
      selectable
    >
      {t("error.reference.label", { code: reference })}
    </Typography.Paragraph>
  );
}
