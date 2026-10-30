import { isNewerMobileVersion, type MobileReleaseNotes } from "@openbot/contracts/mobile-features";
import { createFileRoute } from "@tanstack/solid-router";
import { parseInline } from "../../../lib/changelog";
import { CHANGELOG_RELEASES } from "../../../lib/changelog-releases";
import { json } from "../../../server/request-auth";

// The update header shows the versions between the app and the newest one, so a few are enough.
const MAX_RELEASES = 10;

/** The text of an item without its Markdown: the phone shows plain text. */
function plainText(item: string): string {
  return parseInline(item)
    .map((segment) => segment.text)
    .join("");
}

/**
 * The release notes of the mobile app for `?platform=ios&after=1.4.1`: each version that the store of
 * the platform has, newer than `after`, newest first. It comes from apps/mobile/CHANGELOG.md, as the
 * Mobile tab of /changelog does. It needs no session. An unknown platform gets no release.
 */
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
