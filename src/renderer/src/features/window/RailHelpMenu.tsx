import { HelpMenu, type HelpMenuNews } from "@openbot/ui/features/updates/HelpMenu";
import { whatsNewEntry } from "@openbot/ui/features/updates/whats-new";
import { createSignal } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { useI18n } from "../../i18n-context";
import { compareReleaseVersions } from "../updates/whats-new-history";
import { loadWhatsNewReleases } from "../updates/whats-new-releases";

type HelpLink = "changelog" | "guides" | "discord" | "report-problem" | "feedback";

const HELP_NEWS_COUNT = 3;

export function RailHelpMenu(props: {
  version: string | null;
  onOpenWhatsNew: () => void;
  onOpenLink: (destination: HelpLink) => void;
}) {
  const i18n = useI18n();
  const [news, setNews] = createSignal<readonly HelpMenuNews[]>([]);
  let newsLocale: string | null = null;
  const openLink = (destination: HelpLink) => {
    desktopAnalytics.track("help_link_opened", { destination });
    props.onOpenLink(destination);
  };
  let loadingLocale: string | null = null;

  async function loadNews() {
    const locale = i18n.locale();
    if (loadingLocale === locale || (news().length > 0 && newsLocale === locale)) return;
    loadingLocale = locale;
    if (newsLocale !== locale) setNews([]);
    try {
      const version = props.version;
      const releases = await loadWhatsNewReleases(AbortSignal.timeout(10_000), locale);
      if (loadingLocale !== locale) return;
      setNews(
        releases
          .filter((release) => !version || compareReleaseVersions(release.version, version) <= 0)
          .sort((a, b) => compareReleaseVersions(b.version, a.version))
          .flatMap((release) => {
            const note = release.groups[0]?.items[0];
            return note ? [{ headline: whatsNewEntry(note).headline, date: release.date }] : [];
          })
          .slice(0, HELP_NEWS_COUNT),
      );
      newsLocale = locale;
    } catch {
    } finally {
      if (loadingLocale === locale) loadingLocale = null;
    }
  }

  return (
    <HelpMenu
      news={news()}
      triggerClass="window-rail-button"
      onOpen={() => void loadNews()}
      onOpenWhatsNew={props.onOpenWhatsNew}
      onOpenChangelog={() => openLink("changelog")}
      onOpenGuides={() => openLink("guides")}
      onOpenDiscord={() => openLink("discord")}
      onReportProblem={() => openLink("report-problem")}
      onSendFeedback={() => openLink("feedback")}
    />
  );
}
