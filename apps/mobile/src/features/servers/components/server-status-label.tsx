import { Typography } from "heroui-native";
import { serverStatusLabel } from "@/features/workspace/model/server-status";
import type { MobileServer } from "@/features/workspace/model/workspace-types";

export function ServerStatusLabel({ server, prefix = "" }: { server: MobileServer; prefix?: string }) {
  return (
    <Typography.Paragraph
      type="body-xs"
      accessibilityLabel={`${server.name}: ${serverStatusLabel(server)}`}
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
      {serverStatusLabel(server)}
    </Typography.Paragraph>
  );
}
