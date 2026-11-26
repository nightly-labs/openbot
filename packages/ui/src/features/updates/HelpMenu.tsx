import { BookOpen, Bug, CircleQuestionMark, DropdownMenu, Gift, Megaphone, MotionTooltip } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { CreditIcon } from "../credits/CreditIcon";
import { CreditsExplainerDialog } from "../credits/CreditsExplainerDialog";
import { DiscordMark } from "../settings/brand-marks";

export interface HelpMenuNews {
  headline: string;
  date: string;
}

export interface HelpMenuProps {
  news: readonly HelpMenuNews[];
  triggerClass?: string;
  onOpen?: () => void;
  onOpenWhatsNew: () => void;
  onOpenChangelog: () => void;
  onOpenGuides: () => void;
  onOpenDiscord: () => void;
  onReportProblem: () => void;
  onSendFeedback: () => void;
  onOpenCreditsExplainer?: () => void;
  onOpenCreditPrices?: () => void;
}

function releaseDate(value: string): Date {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function HelpMenu(props: HelpMenuProps) {
  const { t, format } = useText();
  const [open, setOpen] = createSignal(false);
  const [explaining, setExplaining] = createSignal(false);
  const explain = () => {
    props.onOpenCreditsExplainer?.();
    setExplaining(true);
  };
  return (
    <>
      <DropdownMenu.Root
        placement="right-end"
        gutter={10}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) props.onOpen?.();
        }}
      >
        <MotionTooltip content={t("app.help.label")} suppressed={open()}>
          <DropdownMenu.Trigger class={props.triggerClass} aria-label={t("app.help.label")}>
            <CircleQuestionMark aria-hidden="true" />
          </DropdownMenu.Trigger>
        </MotionTooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="agent-context-menu help-menu" aria-label={t("app.help.label")}>
            <Show when={props.news.length > 0}>
              <div class="ui-menu-label" aria-hidden="true">
                {t("app.help.whatsNew")}
              </div>
              <For each={props.news}>
                {(item) => (
                  <DropdownMenu.Item class="help-menu-news" onSelect={() => props.onOpenWhatsNew()}>
                    <span class="help-menu-news-headline" title={item.headline}>
                      {item.headline}
                    </span>
                    <span class="ui-menu-trailing">
                      {format.date(releaseDate(item.date), { month: "short", day: "numeric" })}
                    </span>
                  </DropdownMenu.Item>
                )}
              </For>
            </Show>
            <DropdownMenu.Item onSelect={() => props.onOpenChangelog()}>
              <Gift class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("app.help.changelog")}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => props.onOpenGuides()}>
              <BookOpen class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("app.help.guides")}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={explain}>
              <CreditIcon class="agent-context-icon size-4" />
              <span>{t("billing.credits.explainer.title")}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => props.onOpenDiscord()}>
              <DiscordMark class="agent-context-icon size-4" />
              <span>{t("app.help.discord")}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => props.onReportProblem()}>
              <Bug class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("app.help.reportProblem")}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => props.onSendFeedback()}>
              <Megaphone class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("account.menu.sendFeedback")}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <CreditsExplainerDialog
        open={explaining()}
        onOpenChange={setExplaining}
        onOpenPrices={props.onOpenCreditPrices}
      />
    </>
  );
}
