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
  return (
    <ConfirmDialog
      open={props.open}
      initialFocus="cancel"
      // A removal that is running is not cancellable: half of it has already happened.
      pending={props.busy}
      title={`Uninstall ${props.plan.pluginName}?`}
      description={`This removes what ${props.plan.pluginName} installed on this computer. Nothing else on this host or on this agent changes.`}
      confirmLabel="Uninstall"
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    >
      <Show when={props.plan.appNames.length > 0}>
        <section aria-label={`Apps to remove, ${props.plan.appNames.length}`}>
          <Text tone="muted" variant="label-sm">
            Apps removed from this host
          </Text>
          <ul>
            <For each={props.plan.appNames}>{(name) => <li>{name}</li>}</For>
          </ul>
          {/* Said here rather than after the fact: a sign-in the user granted in a browser is
              dropped with the row, and the next install asks for it again. */}
          <Text tone="muted" variant="label-sm">
            Their tools stop being available, and any sign-in OpenBot kept for them is forgotten.
          </Text>
        </section>
      </Show>

      <Show when={props.plan.skillSlugs.length > 0}>
        <section aria-label={`Skills to remove, ${props.plan.skillSlugs.length}`}>
          <Text tone="muted" variant="label-sm">
            Skills removed from {props.plan.agentName}
          </Text>
          <ul>
            <For each={props.plan.skillSlugs}>{(slug) => <li>{slug}</li>}</For>
          </ul>
        </section>
      </Show>
    </ConfirmDialog>
  );
}
