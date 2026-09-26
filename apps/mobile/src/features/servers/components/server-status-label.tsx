import { Typography } from "heroui-native";
import { serverStatusLabel } from "@/features/workspace/model/server-status";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

export function ServerStatusLabel({ server, prefix = "" }: { server: MobileServer; prefix?: string }) {
  const { t } = useText();
  const label = serverStatusLabel(server, t);
  return (
    <Typography.Paragraph
      type="body-xs"
      accessibilityLabel={`${server.name}: ${label}`}
      accessibilityLiveRegion="polite"
      className={
        server.state === "online"
          ? "text-success-text"
          : server.state === "error"
            ? "text-danger-text"
            : "text-text-secondary"
      }
    >
      {prefix}
      {label}
    </Typography.Paragraph>
  );
}
