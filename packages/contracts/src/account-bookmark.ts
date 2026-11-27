export const ACCOUNT_BOOKMARK_HEADER = "X-OpenBot-D1-Bookmark";

const ACCOUNT_BOOKMARK = /^[0-9a-f]{8}(?:-[0-9a-f]{8,64}){1,7}$/u;

export function isAccountBookmark(value: string | null | undefined): value is string {
  return typeof value === "string" && ACCOUNT_BOOKMARK.test(value);
}

export function newerAccountBookmark(current: string | null, next: string | null): string | null {
  if (!isAccountBookmark(next)) return current;
  return current === null || next > current ? next : current;
}
