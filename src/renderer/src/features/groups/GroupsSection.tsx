import { For, Show } from "solid-js";
import { Button } from "../../components/ui";
import { GroupAvatar } from "./GroupAvatar";
import { useGroups } from "./groups-context";

export function GroupsSection() {
  const groups = useGroups();
  const visible = () => groups.state.groups.filter((group) => group.archived === groups.state.archived);
  return (
    <Show when={groups.supported() && visible().length}>
      <div class="group-navigation">
        <For each={visible()}>
          {(group) => (
            <Button
              variant="ghost"
              fullWidth
              class="group-navigation-row"
              aria-pressed={groups.state.selectedId === group.id ? "true" : "false"}
              onClick={() => void groups.open(group.id)}
            >
              <GroupAvatar members={group.members} />
              <span class="group-navigation-copy">{group.name}</span>
              <Show when={group.activeTasks}>
                <span role="status" aria-label="Working">
                  Working
                </span>
              </Show>
              <Show when={group.unreadCount}>
                <span role="status" class="group-unread" aria-label={`${group.unreadCount} unread`}>
                  {group.unreadCount}
                </span>
              </Show>
            </Button>
          )}
        </For>
      </div>
    </Show>
  );
}
