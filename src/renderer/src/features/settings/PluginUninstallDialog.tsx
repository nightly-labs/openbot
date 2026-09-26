/**
 * The step between pressing Uninstall and the plugin going.
 *
 * An install puts a plugin in two places - MCP servers on the host, skills on one agent - so an
 * uninstall takes things from two places as well. Neither is visible from the other, so the dialog
 * names every piece before it removes any of them: a user who reads "Uninstall Aave?" alone cannot
 * tell whether the skill they wrote instructions around is about to go with it.
 *
 * It lists only what is really there. A plugin the user installed before it published a second app,
 * or whose skill they already removed by hand, must not promise to remove something that is not
 * there to remove - and an agent whose skills this listing never reached is not named at all.
 *
 * `ConfirmDialog` rather than `Dialog`: this is a destructive decision with two answers, so Escape and
 * a click outside cancel it, and nothing about it is dismissible while the removal is running.
 */

import { ConfirmDialog, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";

/** What an uninstall is about to take, as the page found it on this computer. */
export interface PluginUninstallPlan {
  /** The listing's name, for the question the dialog asks. */
  pluginName: string;
  /** The MCP servers this host holds for the plugin's apps, by the name each row took. */
  appNames: readonly string[];
  /** The plugin's skills the chosen agent holds, by slug. */
  skillSlugs: readonly string[];
  /** The agent the skills come off, named only when there are skills to take. */
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
      // A removal that is running is not cancellable: half of it has already happened.
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
          {/* Said here rather than after the fact: a sign-in the user granted in a browser is
              dropped with the row, and the next install asks for it again. */}
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
