import { SkillPreview as SharedSkillPreview } from "@openbot/ui/components/SkillPreview";
import type { ComponentProps } from "@solidjs/web";
import { appPort } from "../app-port";

export function SkillPreview(props: Omit<ComponentProps<typeof SharedSkillPreview>, "onOpenUrl">) {
  return <SharedSkillPreview {...props} onOpenUrl={(url) => appPort().openUrl(url)} />;
}
