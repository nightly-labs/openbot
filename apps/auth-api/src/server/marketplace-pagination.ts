import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { decodeBase64Url, encodeBase64Url } from "./crypto";

const MARKETPLACE_DEFAULT_PAGE_SIZE = 24;
const MARKETPLACE_MAX_PAGE_SIZE = 50;
const MARKETPLACE_MAX_QUERY_LENGTH = 100;
// A name cursor holds a skill name of up to 80 characters, which can need more than 512 characters.
const MAX_CURSOR_LENGTH = 1024;
const MAX_CURSOR_NAME_LENGTH = 80;

/** The orders that skills and agents share. `updated` is the default one: featured first. */
export type MarketplaceSort = "updated" | "installs";
/** All orders that a cursor can name. `recent` and `name` are skill orders only. */
export type MarketplaceCursorSort = MarketplaceSort | "recent" | "name";

export interface MarketplaceCursor {
  primary: number;
  updatedAt: number;
  id: string;
}

export interface MarketplaceRecentCursor {
  updatedAt: number;
  id: string;
}

export interface MarketplaceNameCursor {
  name: string;
  id: string;
}

export class MarketplaceQueryError extends Error {
  constructor(
    readonly code: "invalid_cursor" | "invalid_limit" | "invalid_query",
    message: string,
  ) {
    super(message);
  }
}

export function parseMarketplaceLimit(value: string | null): number {
  if (value === null) return MARKETPLACE_DEFAULT_PAGE_SIZE;
  const parsed = Number(value);
  return normalizeMarketplaceLimit(parsed);
}

export function normalizeMarketplaceLimit(value: number | undefined): number {
  const limit = value ?? MARKETPLACE_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MARKETPLACE_MAX_PAGE_SIZE) {
    throw new MarketplaceQueryError("invalid_limit", "The page limit must be an integer from 1 to 50.");
  }
  return limit;
}

export function normalizeMarketplaceQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const query = value.trim();
  if (query.length > MARKETPLACE_MAX_QUERY_LENGTH) {
    throw new MarketplaceQueryError("invalid_query", "The marketplace query must be 100 characters or fewer.");
  }
  return query || undefined;
}

/** The public name of a creator. A creator with no display name stays anonymous: the email is private. */
export function marketplaceCreatorName(name: string | null | undefined): string {
  return name?.trim() || "OpenBot user";
}

export function marketplaceLikePattern(value: string): string {
  return `%${value.toLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

/**
 * The cursor of each catalog order holds the keys of that order. Its `s` names the order, so the cursor
 * of one order is not accepted for another.
 * - `updated`: featured first, then the latest update. Keys: featured, `updated_at`, id.
 * - `installs`: the most installs first. Keys: installs, `updated_at`, id.
 * - `recent`: the latest update only (skill `sort=updated`). Keys: `updated_at`, id.
 * - `name`: the name A to Z (skill `sort=name`). Keys: the name, id.
 */
export function encodeMarketplaceCursor(sort: MarketplaceSort, cursor: MarketplaceCursor): string;
export function encodeMarketplaceCursor(sort: "recent", cursor: MarketplaceRecentCursor): string;
export function encodeMarketplaceCursor(sort: "name", cursor: MarketplaceNameCursor): string;
export function encodeMarketplaceCursor(
  sort: MarketplaceCursorSort,
  cursor: MarketplaceCursor | MarketplaceRecentCursor | MarketplaceNameCursor,
): string {
  const keys =
    "name" in cursor
      ? { n: cursor.name, i: cursor.id }
      : "primary" in cursor
        ? { p: cursor.primary, u: cursor.updatedAt, i: cursor.id }
        : { u: cursor.updatedAt, i: cursor.id };
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, s: sort, ...keys })));
}

export function decodeMarketplaceCursor(
  value: string | undefined,
  sort: MarketplaceSort,
): MarketplaceCursor | { legacyUpdatedAt: number } | null;
export function decodeMarketplaceCursor(value: string | undefined, sort: "recent"): MarketplaceRecentCursor | null;
export function decodeMarketplaceCursor(value: string | undefined, sort: "name"): MarketplaceNameCursor | null;
export function decodeMarketplaceCursor(
  value: string | undefined,
  sort: MarketplaceCursorSort,
): MarketplaceCursor | MarketplaceRecentCursor | MarketplaceNameCursor | { legacyUpdatedAt: number } | null {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  // A v0 cursor came only from the default order, before cursors held their order.
  if (/^\d+$/u.test(value) && sort === "updated") {
    const legacyUpdatedAt = Number(value);
    if (Number.isSafeInteger(legacyUpdatedAt)) return { legacyUpdatedAt };
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
    if (
      !isDynamicRecord(parsed) ||
      parsed.v !== 1 ||
      parsed.s !== sort ||
      !isString(parsed.i) ||
      parsed.i.length === 0 ||
      parsed.i.length > 128
    ) {
      throw invalidCursor();
    }
    if (sort === "name") {
      if (!isString(parsed.n) || parsed.n.length === 0 || parsed.n.length > MAX_CURSOR_NAME_LENGTH) {
        throw invalidCursor();
      }
      return { name: parsed.n, id: parsed.i };
    }
    if (!isSafeInteger(parsed.u)) throw invalidCursor();
    if (sort === "recent") return { updatedAt: parsed.u, id: parsed.i };
    if (!isSafeInteger(parsed.p)) throw invalidCursor();
    return { primary: parsed.p, updatedAt: parsed.u, id: parsed.i };
  } catch (error) {
    if (error instanceof MarketplaceQueryError) throw error;
    throw invalidCursor();
  }
}

function isSafeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value);
}

function invalidCursor(): MarketplaceQueryError {
  return new MarketplaceQueryError("invalid_cursor", "The marketplace cursor is invalid.");
}
