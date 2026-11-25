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

const GITHUB_LINK = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+/iu;

export function githubLinkOf(model: MarketplaceModel, query: string): string | null {
  const text = query.trim();
  return model.readGithubSkills && GITHUB_LINK.test(text) ? text : null;
}

const READ_DELAY_MS = 400;

export function createGithubRead(model: () => MarketplaceModel, link: () => string | null) {
  const [read, setRead] = createSignal<GithubSkillRead | "reading" | null>(null);
  let request = 0;
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

export function githubListings(source: GithubSkillSource): MarketplaceSkillSummary[] {
  return source.skills.map((skill) => githubSkillDetail(source, skill));
}

export function githubOrigin(skillId: string): { repository: string; commit: string; url: string } | null {
  const address = parseGithubSkillId(skillId);
  if (!address) return null;
  return {
    repository: `${address.owner}/${address.repo}`,
    commit: address.commit.slice(0, 7),
    url: githubSkillUrl(address),
  };
}

export function GithubTrustNote() {
  const { t } = useText();
  return (
    <p class="marketplace-github-trust">
      <TriangleAlert aria-hidden="true" />
      <span>{t("marketplace.skills.github.trust")}</span>
    </p>
  );
}
