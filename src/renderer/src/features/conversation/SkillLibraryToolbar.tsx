import { Button, SlidingTabs } from "../../components/ui";

export function SkillLibraryToolbar(props: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div class="agent-skills-toolbar">
      <SlidingTabs.List aria-label="Skill source">
        <SlidingTabs.Trigger value="all">All</SlidingTabs.Trigger>
        <SlidingTabs.Trigger value="local">Local</SlidingTabs.Trigger>
        <SlidingTabs.Trigger value="enabled">Enabled</SlidingTabs.Trigger>
      </SlidingTabs.List>
      <Button size="sm" disabled={!props.canCreate} onClick={props.onCreate}>
        Create skill
      </Button>
    </div>
  );
}
