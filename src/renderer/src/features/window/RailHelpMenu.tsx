import { HelpMenu, type HelpMenuNews } from "@openbot/ui/features/updates/HelpMenu";
import { whatsNewEntry } from "@openbot/ui/features/updates/whats-new";
import { createSignal } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { compareReleaseVersions } from "../updates/whats-new-history";
import { loadWhatsNewReleases } from "../updates/whats-new-releases";

/** The newest releases that the Help menu lists, one line each. */
const HELP_NEWS_COUNT = 3;

/**
 * The Help menu of the rail, on desktop and on the web. The first time it opens, it reads the release
 * notes in the app and lists the first note of each of the newest releases, up to `version`. The web
 * has no version: it always runs the newest release.
 */
export function RailHelpMenu(props: {
  version: string | null;
  onOpenWhatsNew: () => void;
  onOpenLink: (destination: "changelog" | "guides" | "discord" | "feedback") => void;
}) {
  const [news, setNews] = createSignal<readonly HelpMenuNews[]>([]);
  const openLink = (destination: "changelog" | "guides" | "discord" | "feedback") => {
    desktopAnalytics.track("help_link_opened", { destination });
    props.onOpenLink(destination);
  };
  let loading = false;

  async function loadNews() {
    if (loading || news().length > 0) return;
    loading = true;
    try {
      const version = props.version;
      const releases = await loadWhatsNewReleases(AbortSignal.timeout(10_000));
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
    } catch {
      // The menu shows its links without the list. The next opening tries again.
    } finally {
      loading = false;
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
      onSendFeedback={() => openLink("feedback")}
    />
  );
}
