import { Button, SlidingTabs } from "@openbot/ui";
import { Show } from "solid-js";

/** `localTab` defaults to true. It is false for an agent on a joined server: the library is on the host. */
export function SkillLibraryToolbar(props: { canCreate: boolean; onCreate: () => void; localTab?: boolean }) {
  return (
    <div class="agent-skills-toolbar">
      <SlidingTabs.List aria-label="Skill source">
        <SlidingTabs.Trigger value="all">All</SlidingTabs.Trigger>
        <Show when={props.localTab !== false}>
          <SlidingTabs.Trigger value="local">Local</SlidingTabs.Trigger>
        </Show>
        <SlidingTabs.Trigger value="enabled">Enabled</SlidingTabs.Trigger>
      </SlidingTabs.List>
      <Button size="sm" disabled={!props.canCreate} onClick={props.onCreate}>
        Create skill
      </Button>
    </div>
  );
}
