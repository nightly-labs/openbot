import { ConfirmDialog, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";

export interface PluginUninstallPlan {
  pluginName: string;
  appNames: readonly string[];
  skillSlugs: readonly string[];
  agentName: string;
}

export function PluginUninstallDialog(props: {
  open: boolean;
  plan: PluginUninstallPlan;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useText();
  return (
    <ConfirmDialog
      open={props.open}
      initialFocus="cancel"
      pending={props.busy}
      title={t("plugin.uninstallDialog.title", { name: props.plan.pluginName })}
      description={t("plugin.uninstallDialog.description", { name: props.plan.pluginName })}
      confirmLabel={t("plugin.uninstallDialog.confirm")}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    >
      <Show when={props.plan.appNames.length > 0}>
        <section aria-label={t("plugin.uninstallDialog.appsLabel", { number: props.plan.appNames.length })}>
          <Text tone="muted" variant="label-sm">
            {t("plugin.uninstallDialog.appsTitle")}
          </Text>
          <ul>
            <For each={props.plan.appNames}>{(name) => <li>{name}</li>}</For>
          </ul>
          <Text tone="muted" variant="label-sm">
            {t("plugin.uninstallDialog.appsNote")}
          </Text>
        </section>
      </Show>

      <Show when={props.plan.skillSlugs.length > 0}>
        <section aria-label={t("plugin.uninstallDialog.skillsLabel", { number: props.plan.skillSlugs.length })}>
          <Text tone="muted" variant="label-sm">
            {t("plugin.uninstallDialog.skillsTitle", { agentName: props.plan.agentName })}
          </Text>
          <ul>
            <For each={props.plan.skillSlugs}>{(slug) => <li>{slug}</li>}</For>
          </ul>
        </section>
      </Show>
    </ConfirmDialog>
  );
}
