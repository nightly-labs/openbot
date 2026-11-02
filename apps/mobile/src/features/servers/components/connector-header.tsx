import { Typography } from "heroui-native";
import { View } from "react-native";
import { ConnectorLogo } from "@/features/servers/components/connector-logo";
import { CONNECTOR_TITLE_KEYS, type MobileConnectorId } from "@/features/servers/model/connectors";
import { useText } from "@/shared/lib/text";

/** The logo, name, status and description at the top of a connector page. */
export function ConnectorHeader({
  id,
  status,
  attention = false,
  description,
}: {
  id: MobileConnectorId;
  status: string | null;
  attention?: boolean;
  description: string;
}) {
  const { t } = useText();
  return (
    <View className="items-center gap-2 px-4">
      <ConnectorLogo id={id} size={64} />
      <Typography.Heading type="h4" align="center" className="mt-1">
        {t(CONNECTOR_TITLE_KEYS[id])}
      </Typography.Heading>
      {status ? (
        <Typography.Paragraph
          type="body-xs"
          align="center"
          className={attention ? "text-warning-text" : "text-grouped-secondary"}
        >
          {status}
        </Typography.Paragraph>
      ) : null}
      <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary">
        {description}
      </Typography.Paragraph>
    </View>
  );
}

/** The reason that the last change or read failed, under the header. */
export function ConnectorError({ message }: { message: string | null }) {
  return message ? (
    <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
      {message}
    </Typography.Paragraph>
  ) : null;
}
