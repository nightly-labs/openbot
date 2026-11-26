import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { ItemGroup, SettingsSection } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { type Accessor, Show } from "solid-js";
import { ServerBrowsingMemorySetting } from "./ServerBrowsingMemorySetting";
import { ServerMemoryLimitSetting } from "./ServerMemoryLimitSetting";
import { ServerMemoryReviewSetting } from "./ServerMemoryReviewSetting";
import { ServerSkillLearningSetting } from "./ServerSkillLearningSetting";
import { serverCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

interface ServerMemorySection {
  available: Accessor<boolean>;
  Panel: () => JSX.Element;
}

export function createServerMemorySection(host: ServerSettingsSectionHost): ServerMemorySection {
  const { t } = useText();
  const { props, actionsAvailable, busy, run } = host;
  const canSet = (capability: TeamCurrentCapability) =>
    serverCanAdminister(props.server, capability) && actionsAvailable();
  const memoryLimit = () => (canSet("agent-memory-limit-v1") ? props.hostMemoryLimit : undefined);
  const memoryReview = () => (canSet("memory-review-v1") ? props.memoryReview : undefined);
  const skillLearning = () => (canSet("skill-learning-v1") ? props.skillLearning : undefined);
  const browsingMemory = () => (canSet("browsing-memory-v1") ? props.browsingMemory : undefined);
  const available = () => Boolean(memoryLimit() || memoryReview() || skillLearning() || browsingMemory());

  function Panel() {
    return (
      <>
        <Show when={memoryLimit() || memoryReview()}>
          <SettingsSection title={t("server.settings.memoriesCard")}>
            <ItemGroup class="settings-modal-card">
              <Show when={memoryLimit()}>
                {(options) => (
                  <ServerMemoryLimitSetting
                    {...options()}
                    serverId={props.server.id}
                    disabled={Boolean(busy())}
                    menuMount={host.menuMount()}
                    run={run}
                  />
                )}
              </Show>
              <Show when={memoryReview()}>
                {(options) => (
                  <ServerMemoryReviewSetting
                    {...options()}
                    serverId={props.server.id}
                    disabled={Boolean(busy())}
                    menuMount={host.menuMount()}
                    run={run}
                  />
                )}
              </Show>
            </ItemGroup>
          </SettingsSection>
        </Show>
        <Show when={skillLearning() || browsingMemory()}>
          <SettingsSection title={t("server.settings.learningCard")}>
            <ItemGroup class="settings-modal-card">
              <Show when={skillLearning()}>
                {(options) => (
                  <ServerSkillLearningSetting
                    {...options()}
                    serverId={props.server.id}
                    disabled={Boolean(busy())}
                    menuMount={host.menuMount()}
                    run={run}
                  />
                )}
              </Show>
              <Show when={browsingMemory()}>
                {(options) => (
                  <ServerBrowsingMemorySetting
                    {...options()}
                    serverId={props.server.id}
                    disabled={Boolean(busy())}
                    run={run}
                  />
                )}
              </Show>
            </ItemGroup>
          </SettingsSection>
        </Show>
      </>
    );
  }

  return { available, Panel };
}
