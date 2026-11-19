import { Typography } from "heroui-native";

export function SaveError({ error }: { error: string | null }) {
  return error ? (
    <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
      {error}
    </Typography.Paragraph>
  ) : null;
}
