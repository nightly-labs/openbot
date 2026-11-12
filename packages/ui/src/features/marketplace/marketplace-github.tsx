import {
  type GithubSkillSource,
  githubSkillDetail,
  githubSkillUrl,
  type MarketplaceSkillSummary,
  parseGithubSkillId,
} from "@openbot/contracts/ipc";
import { TriangleAlert } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import type { GithubSkillRead, MarketplaceModel } from "./marketplace-model";

/** A link to a repository on GitHub, with or without a scheme. A folder or a file link is one too. */
const GITHUB_LINK = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+/iu;

/** The search text, when it is a GitHub link that the server can read. */
export function githubLinkOf(model: MarketplaceModel, query: string): string | null {
  const text = query.trim();
  return model.readGithubSkills && GITHUB_LINK.test(text) ? text : null;
}

/** The read waits until the user stops typing: each read uses the GitHub limit. */
const READ_DELAY_MS = 400;

/**
 * Reads the link that `link` gives each time it changes. An older answer does not replace a newer
 * one. `"reading"` while the server reads the link.
 */
export function createGithubRead(model: () => MarketplaceModel, link: () => string | null) {
  const [read, setRead] = createSignal<GithubSkillRead | "reading" | null>(null);
  let request = 0;
  // The reader is read in the compute: its getter can make a memo, which an effect callback cannot.
  createEffect(
    () => ({ value: link(), reader: model().readGithubSkills }),
    ({ value, reader }) => {
      const id = ++request;
      if (!value || !reader) {
        setRead(null);
        return;
      }
      setRead("reading");
      const timer = setTimeout(() => {
        void reader(value).then((result) => {
          if (id === request) setRead(result);
        });
      }, READ_DELAY_MS);
      return () => clearTimeout(timer);
    },
  );
  return read;
}

/** The skills of a read as catalog listings, so the rows, the skill page and the agents dialog take them. */
export function githubListings(source: GithubSkillSource): MarketplaceSkillSummary[] {
  return source.skills.map((skill) => githubSkillDetail(source, skill));
}

/** `owner/name` and the short commit of a GitHub skill id, or null when the id is not one. */
export function githubOrigin(skillId: string): { repository: string; commit: string; url: string } | null {
  const address = parseGithubSkillId(skillId);
  if (!address) return null;
  return {
    repository: `${address.owner}/${address.repo}`,
    commit: address.commit.slice(0, 7),
    url: githubSkillUrl(address),
  };
}

/** OpenBot does not review a skill from GitHub. The note shows where the user adds one. */
export function GithubTrustNote() {
  const { t } = useText();
  return (
    <p class="marketplace-github-trust">
      <TriangleAlert aria-hidden="true" />
      <span>{t("marketplace.skills.github.trust")}</span>
    </p>
  );
}
