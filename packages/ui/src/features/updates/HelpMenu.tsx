import { BookOpen, CircleQuestionMark, DropdownMenu, Gift, Megaphone, MotionTooltip } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { DiscordMark } from "../settings/brand-marks";

/** One line of the What's new list: the headline of a release note and the date of its release. */
export interface HelpMenuNews {
  headline: string;
  /** `YYYY-MM-DD`, as the release notes write it. */
  date: string;
}

export interface HelpMenuProps {
  /** Newest first. The menu shows no What's new list while it is empty. */
  news: readonly HelpMenuNews[];
  /** The class of the button that opens the menu, so it matches the buttons around it. */
  triggerClass?: string;
  /** Called when the menu opens, so the caller can load the news. */
  onOpen?: () => void;
  onOpenWhatsNew: () => void;
  onOpenChangelog: () => void;
  onOpenGuides: () => void;
  onOpenDiscord: () => void;
  onSendFeedback: () => void;
}

/** A release date in local time. `new Date("YYYY-MM-DD")` reads UTC and can show the day before. */
function releaseDate(value: string): Date {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The Help menu: the newest release notes, the changelog, the guides, the Discord community and feedback. */
export function HelpMenu(props: HelpMenuProps) {
  const { t, format } = useText();
  const [open, setOpen] = createSignal(false);
  return (
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
          <DropdownMenu.Item onSelect={() => props.onOpenDiscord()}>
            <DiscordMark class="agent-context-icon size-4" />
            <span>{t("app.help.discord")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => props.onSendFeedback()}>
            <Megaphone class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("account.menu.sendFeedback")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
