import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show } from "solid-js";
import type { WorkingDirectoryCalls } from "./WorkingDirectorySettings";

export function WorkingDirectoryLabel(props: {
  agentId: string;
  revision?: string | null;
  calls: WorkingDirectoryCalls;
  onOpen: () => void;
}) {
  const { t } = useText();
  const [path, setPath] = createSignal<string | null>(null);
  createEffect(
    () => [props.agentId, props.calls, props.revision] as const,
    ([agentId, calls]) => {
      let active = true;
      setPath(null);
      void calls
        .getWorkingDirectory(agentId)
        .then((settings) => {
          if (active) setPath(settings.effectivePath);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    },
  );
  return (
    <Show when={path()}>
      {(current) => (
        <Button
          variant="ghost"
          title={current()}
          aria-label={`${t("agentSettings.runtime.workingDirectory")}: ${current()}`}
          onClick={props.onOpen}
        >
          {current().split(/[\\/]/).filter(Boolean).at(-1) ?? current()}
        </Button>
      )}
    </Show>
  );
}
