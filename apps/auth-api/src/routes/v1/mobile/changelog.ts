import { isNewerMobileVersion, type MobileReleaseNotes } from "@openbot/contracts/mobile-features";
import { createFileRoute } from "@tanstack/solid-router";
import { parseInline } from "../../../lib/changelog";
import { CHANGELOG_RELEASES } from "../../../lib/changelog-releases";
import { json } from "../../../server/request-auth";

const MAX_RELEASES = 10;

function plainText(item: string): string {
  return parseInline(item)
    .map((segment) => segment.text)
    .join("");
}

export const Route = createFileRoute("/v1/mobile/changelog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams;
        const platform = query.get("platform");
        const after = query.get("after");
        const releases: MobileReleaseNotes[] =
          platform === "ios" || platform === "android"
            ? CHANGELOG_RELEASES.mobile
                .flatMap((release) => {
                  const date = release.stores.find((store) => store.store === platform)?.date;
                  if (!date || (after && !isNewerMobileVersion(release.version, after))) return [];
                  const notices = release.notices.length
                    ? [{ type: "notice", heading: "", items: release.notices.map(plainText) }]
                    : [];
                  const groups = release.groups.map((group) => ({
                    type: group.type,
                    heading: group.heading,
                    items: group.items.map(plainText),
                  }));
                  return [{ version: release.version, date, groups: [...notices, ...groups] }];
                })
                .slice(0, MAX_RELEASES)
            : [];
        return json({ releases });
      },
    },
  },
});
