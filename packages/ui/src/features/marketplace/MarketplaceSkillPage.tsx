import type { MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { skillExamplePrompt, skillInstructions } from "@openbot/ui/components/SkillPreview";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { useText } from "@openbot/ui/text";
import { createEffect, Show } from "solid-js";
import { useInstalls } from "./MarketplaceCards";
import { SkillAction, skillAgents } from "./MarketplaceInstallSkill";
import { Block, DetailState, PageHead, Properties, SkillIcon, SkillMark, TryCard } from "./MarketplaceParts";
import { CATEGORY_LABELS } from "./marketplace-listing";
import { createDetail, type MarketplaceScope } from "./marketplace-view";

export function MarketplaceSkillPage(props: { scope: MarketplaceScope; listing: MarketplaceSkillSummary }) {
  const { t, format } = useText();
  const installs = useInstalls();
  const model = () => props.scope.model;
  const detail = createDetail(() => model().loadSkill(props.listing.id));
  /* The loaded detail can be newer than the listing, and the Try card sends its instructions. */
  const skill = () => detail.value() ?? props.listing;
  // An effect, not `onSettled`: the read goes through the owner's props, and a prop that the
  // owner computes makes a memo, which `onSettled` refuses.
  createEffect(
    () => props.listing.id,
    () => model().readSkills(),
  );

  /* An agent can try the skill when it has this version and the skill is on. */
  const usable = (agentId: string) => {
    const installed = model().installedSkill(agentId, skill().id);
    return (
      installed !== undefined &&
      installed.enabled !== false &&
      installed.state !== "needs-repair" &&
      installed.installedVersion >= skill().version
    );
  };
  /** The agent whose chat is open, when it can try the skill; else the first agent that can. */
  const tryAgent = () => {
    const agents = model()
      .agents()
      .filter((agent) => usable(agent.id));
    return agents.find((agent) => agent.id === model().activeAgentId()) ?? agents[0];
  };
  /** Why the Try arrow is off, when the reason is not on the page already. */
  const reason = () => {
    if (tryAgent()) return model().trySkill ? undefined : t("marketplace.try.composerUnavailable");
    if (
      model()
        .agents()
        .some((agent) => model().skillRead(agent.id) === "failed")
    )
      return t("marketplace.try.readFailed");
    const have = skillAgents(props.scope, skill()).flatMap(
      (agent) => model().installedSkill(agent.id, skill().id) ?? [],
    );
    if (have.length === 0) return undefined;
    if (have.some((installed) => installed.enabled === false)) return t("marketplace.try.enable");
    if (have.some((installed) => installed.state === "needs-repair")) return t("marketplace.try.repair");
    return t("marketplace.try.update");
  };

  return (
    <div class="marketplace-view">
      <PageHead
        media={<SkillMark skill={skill()} size="md" />}
        title={skill().name}
        description={skill().description}
        actions={<SkillAction scope={props.scope} skill={skill()} />}
      />
      <DetailState status={detail.status()} loadingLabel={t("marketplace.skill.loading")} onRetry={detail.retry}>
        <Show when={detail.value()}>
          {(full) => (
            <TryCard
              seed={skill().name}
              chip={{
                kind: "skill",
                name: skill().name,
                icon: <SkillIcon url={skill().iconUrl} />,
              }}
              requests={[{ id: "example", text: skillExamplePrompt(full(), t) }]}
              tryLabel={() => {
                const agent = tryAgent();
                return agent ? t("marketplace.try.in", { name: agent.name }) : t("skill.preview.try");
              }}
              onTry={
                tryAgent() && model().trySkill
                  ? () => {
                      const agent = tryAgent();
                      if (agent) model().trySkill?.(agent.id, full());
                    }
                  : undefined
              }
              caption={reason()}
            />
          )}
        </Show>
      </DetailState>
      <div class="marketplace-page">
        <div class="marketplace-stack">
          <Show when={detail.value()}>
            {(full) => (
              <Block id="marketplace-skill-doc" level="h4" title={t("marketplace.skill.doc")}>
                <div class="marketplace-doc message-markdown">
                  <MarkdownMessageText
                    imagesAsLinks
                    body={skillInstructions(full())}
                    agents={[]}
                    onSelectAgent={() => undefined}
                    onOpenLink={(url) => model().openUrl(url)}
                  />
                </div>
              </Block>
            )}
          </Show>
        </div>
        <Properties
          label={t("marketplace.properties.skill")}
          items={[
            { label: t("marketplace.properties.creator"), value: skill().creatorName },
            { label: t("marketplace.properties.category"), value: t(CATEGORY_LABELS[skill().category]) },
            { label: t("marketplace.properties.version"), value: format.number(skill().version) },
            {
              label: t("marketplace.properties.updated"),
              value: format.date(new Date(skill().updatedAt), { dateStyle: "medium" }),
            },
            { label: t("marketplace.properties.installs"), value: installs(skill().installs) },
          ]}
        />
      </div>
    </div>
  );
}
