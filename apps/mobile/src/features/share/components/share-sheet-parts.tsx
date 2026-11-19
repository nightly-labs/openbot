import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { AttachmentThumbnail } from "@/features/chat/components/attachment-preview";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import type { IncomingShare } from "../model/incoming-share";

export function ShareContentSection({ share, footer }: { share: IncomingShare; footer?: string }) {
  const { t, format } = useText();
  return (
    <SettingsSection title={t("mobile.share.content")} footer={footer}>
      {share.text ? (
        <SettingsRow disclosure={false}>
          <Typography.Paragraph numberOfLines={4}>{share.text}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {share.files.map((file) => (
        <SettingsRow
          key={file.uri}
          disclosure={false}
          leading={
            <AttachmentThumbnail
              name={file.name}
              uri={attachmentMimeTypeForName(file.name).startsWith("image/") ? file.uri : null}
            />
          }
          supportingText={file.size === null ? undefined : format.fileSize(file.size)}
        >
          <Typography.Paragraph numberOfLines={1}>{file.name}</Typography.Paragraph>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

export function AgentChoice({
  agent,
  checked,
  disabled,
  onSelect,
}: {
  agent: MobileAgent;
  checked: boolean;
  disabled?: boolean;
  onSelect: (agent: MobileAgent) => void;
}) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <SettingsRow
      checked={checked}
      disabled={disabled}
      disclosure={false}
      accessibilityLabel={agent.name}
      leading={
        <BloubAvatar
          agentId={agent.id}
          serverId={agent.serverId}
          hue={agent.avatarHue}
          color={agent.avatarColor}
          seed={agent.avatarSeed}
          size={36}
          animateIdle={false}
        />
      }
      trailing={checked ? <Check size={18} color={accent} strokeWidth={2} /> : null}
      onPress={() => onSelect(agent)}
    >
      <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
    </SettingsRow>
  );
}
