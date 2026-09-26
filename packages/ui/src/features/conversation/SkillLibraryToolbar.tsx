import { Button, SlidingTabs } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

/** `localTab` defaults to true. It is false for an agent on a joined server: the library is on the host. */
export function SkillLibraryToolbar(props: { canCreate: boolean; onCreate: () => void; localTab?: boolean }) {
  const { t } = useText();
  return (
    <div class="agent-skills-toolbar">
      <SlidingTabs.List aria-label={t("skill.toolbar.source")}>
        <SlidingTabs.Trigger value="all">{t("skill.toolbar.all")}</SlidingTabs.Trigger>
        <Show when={props.localTab !== false}>
          <SlidingTabs.Trigger value="local">{t("skill.toolbar.local")}</SlidingTabs.Trigger>
        </Show>
        <SlidingTabs.Trigger value="enabled">{t("skill.toolbar.enabled")}</SlidingTabs.Trigger>
      </SlidingTabs.List>
      <Button size="sm" disabled={!props.canCreate} onClick={props.onCreate}>
        {t("skill.toolbar.create")}
      </Button>
    </div>
  );
}
