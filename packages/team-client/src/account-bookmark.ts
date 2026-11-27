import { ACCOUNT_BOOKMARK_HEADER, newerAccountBookmark } from "@openbot/contracts/account-bookmark";

const bookmarks = new Map<string, string>();

function accountOrigin(url: string | URL): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function accountBookmarkHeaders(url: string | URL): Record<string, string> {
  const origin = accountOrigin(url);
  const bookmark = origin === null ? undefined : bookmarks.get(origin);
  return bookmark === undefined ? {} : { [ACCOUNT_BOOKMARK_HEADER]: bookmark };
}

export function rememberAccountBookmark(url: string | URL, response: Pick<Response, "status" | "headers">): void {
  const origin = accountOrigin(url);
  if (origin === null) return;
  if (response.status >= 500) {
    bookmarks.delete(origin);
    return;
  }
  const next = newerAccountBookmark(bookmarks.get(origin) ?? null, response.headers.get(ACCOUNT_BOOKMARK_HEADER));
  if (next !== null) bookmarks.set(origin, next);
}
