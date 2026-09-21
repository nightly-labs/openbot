import { SkillPreview as SharedSkillPreview } from "@openbot/ui/components/SkillPreview";
import type { ComponentProps } from "@solidjs/web";

export function SkillPreview(props: Omit<ComponentProps<typeof SharedSkillPreview>, "onOpenUrl">) {
  return <SharedSkillPreview {...props} onOpenUrl={(url) => window.openbot.openUrl(url)} />;
}
