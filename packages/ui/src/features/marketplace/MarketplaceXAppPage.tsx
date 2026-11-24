import { X_AGENT_LISTING_ID, X_EXTENSION_URL } from "@openbot/contracts/browser-extension-x";
import type { MarketplaceAgentDetail } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  Check,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  MessageCircle,
  Puzzle,
  SettingsSection,
  Spinner,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import { XTile } from "../settings/brand-marks";
import { IntegrationPage, LogoTile, Stepper, WizardDialog } from "../settings/IntegrationLayout";
import type { MarketplaceApp } from "./marketplace-model";
import type { MarketplaceScope } from "./marketplace-view";

type XApp = Extract<MarketplaceApp, { kind: "x" }>;

type SetupStep = 0 | 1 | 2;

const HOW_IT_WORKS = [
  ["marketplace.xApp.howReplyTitle", "marketplace.xApp.howReply"],
  ["marketplace.xApp.howSendTitle", "marketplace.xApp.howSend"],
  ["marketplace.xApp.howWorkTitle", "marketplace.xApp.howWork"],
] as const satisfies readonly (readonly [AppTextKey, AppTextKey])[];

const EXTENSION_STEPS = [
  "marketplace.xApp.extensionStepStore",
  "marketplace.xApp.extensionStepAdd",
  "marketplace.xApp.extensionStepSignIn",
] as const satisfies readonly AppTextKey[];

const AGENT_DOES = [
  "marketplace.xApp.agentDoesReceive",
  "marketplace.xApp.agentDoesWork",
  "marketplace.xApp.agentDoesNoPost",
] as const satisfies readonly AppTextKey[];

const STEP_COPY = [
  ["marketplace.xApp.extensionStepTitle", "marketplace.xApp.extensionStepDescription"],
  ["marketplace.xApp.agentStepTitle", "marketplace.xApp.agentStepDescription"],
  ["marketplace.xApp.doneTitle", "marketplace.xApp.doneDescription"],
] as const satisfies readonly (readonly [AppTextKey, AppTextKey])[];

export function MarketplaceXAppPage(props: {
  scope: MarketplaceScope;
  app: XApp;
  setup: boolean;
  details: JSX.Element;
}) {
  const { t } = useText();
  const model = () => props.scope.model;
  const [open, setOpen] = createSignal(props.setup && props.app.agent === null);
  const [step, setStep] = createSignal<SetupStep>(0);
  const [listing, setListing] = createSignal<MarketplaceAgentDetail | undefined>();
  const busy = () => model().agentBusy(X_AGENT_LISTING_ID);
  const begin = () => {
    setStep(0);
    setOpen(true);
  };
  const showAgentStep = () => {
    setStep(1);
    if (listing()) return;
    void model()
      .loadAgent(X_AGENT_LISTING_ID)
      .then((detail) => {
        if (detail) setListing(detail);
        else setStep(0);
      });
  };
  const add = (detail: MarketplaceAgentDetail) => {
    void model()
      .addAgent(detail)
      .then((added) => {
        if (added) setStep(2);
      });
  };
  const openExtension = () => model().openUrl(X_EXTENSION_URL);
  return (
    <IntegrationPage
      class="marketplace-x-page"
      logo={<XTile />}
      name={props.app.name}
      status={props.app.agent ? "connected" : "idle"}
      statusLabel={t(props.app.agent ? "marketplace.app.connected" : "marketplace.xApp.notSetUp")}
      subtitle={props.app.tagline}
      actions={
        <Show when={!props.app.agent}>
          <Button type="button" size="sm" onClick={begin}>
            {t("marketplace.xApp.setUp")}
          </Button>
        </Show>
      }
      details={props.details}
    >
      <Show
        when={props.app.agent}
        fallback={
          <SettingsSection title={t("marketplace.xApp.howTitle")}>
            <ItemGroup class="settings-modal-card">
              <ol class="marketplace-x-how">
                <For each={HOW_IT_WORKS}>
                  {([title, body], index) => (
                    <li>
                      <span class="marketplace-x-how-index" aria-hidden="true">
                        {index() + 1}
                      </span>
                      <Text as="span" variant="body-sm">
                        <strong>{t(title)}</strong> {t(body)}
                      </Text>
                    </li>
                  )}
                </For>
              </ol>
            </ItemGroup>
          </SettingsSection>
        }
      >
        {(agent) => (
          <>
            <SettingsSection
              title={t("marketplace.xApp.agentTitle")}
              description={t("marketplace.xApp.agentDescription")}
            >
              <ItemGroup class="settings-modal-card">
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <span class="integrations-agent-face" data-size="md">
                      <AgentAvatar agent={agent()} motion="idle" />
                    </span>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{agent().name}</ItemTitle>
                    <ItemDescription>{agent().title}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => model().openChat(X_AGENT_LISTING_ID)}
                    >
                      <MessageCircle aria-hidden="true" />
                      {t("marketplace.agent.openChat")}
                    </Button>
                  </ItemActions>
                </Item>
              </ItemGroup>
            </SettingsSection>
            <SettingsSection
              title={t("marketplace.xApp.extensionTitle")}
              description={t("marketplace.xApp.extensionDescription")}
            >
              <ItemGroup class="settings-modal-card">
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <LogoTile>
                      <Puzzle aria-hidden="true" />
                    </LogoTile>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t("marketplace.xApp.extensionName")}</ItemTitle>
                    <ItemDescription>{t("marketplace.xApp.extensionNote")}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ExtensionButton onClick={openExtension} />
                  </ItemActions>
                </Item>
              </ItemGroup>
            </SettingsSection>
          </>
        )}
      </Show>
      <WizardDialog
        open={open()}
        closeLabel={t("common.close")}
        dismissible={!busy()}
        closeDisabled={busy()}
        onClose={() => setOpen(false)}
        logo={<XTile />}
        link={step() === 2 ? "connected" : "connecting"}
        title={t(STEP_COPY[step()][0])}
        description={t(STEP_COPY[step()][1])}
        stepper={
          <Stepper
            steps={[t("marketplace.xApp.stepExtension"), t("marketplace.xApp.stepAgent")]}
            current={step()}
            label={t("marketplace.xApp.setUp")}
          />
        }
        footer={
          <Switch>
            <Match when={step() === 0}>
              <ExtensionButton onClick={openExtension} />
              <Button type="button" size="sm" onClick={showAgentStep}>
                {t("marketplace.xApp.next")}
              </Button>
            </Match>
            <Match when={step() === 1}>
              <Button type="button" size="sm" variant="ghost" disabled={busy()} onClick={() => setStep(0)}>
                {t("common.back")}
              </Button>
              <Button
                type="button"
                size="sm"
                loading={busy()}
                disabled={!listing()}
                onClick={() => {
                  const detail = listing();
                  if (detail) add(detail);
                }}
              >
                {t("marketplace.xApp.addAgent")}
              </Button>
            </Match>
            <Match when={step() === 2}>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                {t("common.done")}
              </Button>
            </Match>
          </Switch>
        }
      >
        <Switch>
          <Match when={step() === 0}>
            <ol class="channel-checklist">
              <For each={EXTENSION_STEPS}>
                {(line) => (
                  <li>
                    <span class="channel-checklist-dot" aria-hidden="true" />
                    {t(line)}
                  </li>
                )}
              </For>
            </ol>
          </Match>
          <Match when={step() === 1}>
            <Show
              when={listing()}
              fallback={
                <div class="channel-waiting">
                  <Spinner size="sm" />
                </div>
              }
            >
              {(detail) => (
                <div class="channel-orchestrator-card">
                  <span class="integrations-agent-face" data-size="lg">
                    <AgentAvatar
                      seed={detail().avatarSeed}
                      hue={detail().avatarHue}
                      url={detail().avatarUrl}
                      motion="idle"
                    />
                  </span>
                  <div class="channel-stack">
                    <Text as="span" variant="label">
                      {detail().name}
                    </Text>
                    <Text as="span" variant="caption" tone="muted">
                      {detail().title}
                    </Text>
                  </div>
                </div>
              )}
            </Show>
            <ol class="channel-checklist">
              <For each={AGENT_DOES}>
                {(line) => (
                  <li data-state="done">
                    <Check size={14} aria-hidden="true" />
                    {t(line)}
                  </li>
                )}
              </For>
            </ol>
          </Match>
        </Switch>
      </WizardDialog>
    </IntegrationPage>
  );
}

function ExtensionButton(props: { onClick: () => void }) {
  const { t } = useText();
  return (
    <Button type="button" size="sm" variant="outline" onClick={props.onClick}>
      <ExternalLink aria-hidden="true" />
      {t("marketplace.xApp.getExtension")}
    </Button>
  );
}
