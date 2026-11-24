import {
  CREDIT_CODE_ALPHABET,
  CREDIT_CODE_LENGTH,
  type CreditRedeemRequest,
  creditsFromTenths,
  isCreditCode,
  normalizeCreditCode,
} from "@openbot/contracts/credits";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { BillingError, type BillingOperationError, billingCall } from "./billing-errors";

type Failure = BillingError | BillingOperationError;

export const CREDIT_CODE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
export const CREDIT_CODE_LIMIT_NAMES = [
  "account_tries",
  "network_tries",
  "account_wrong",
  "network_wrong",
  "network_code",
] as const;
export type CreditCodeLimit = (typeof CREDIT_CODE_LIMIT_NAMES)[number];
export const CREDIT_CODE_LIMITS: Readonly<Record<CreditCodeLimit, number>> = {
  account_tries: 30,
  network_tries: 120,
  account_wrong: 10,
  network_wrong: 30,
  network_code: 20,
};
export const CREDIT_CODE_CAMPAIGN_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const CREDIT_CODE_OUTCOMES = [
  "redeemed",
  "invalid",
  "disabled",
  "expired",
  "used_up",
  "redeemed_before",
  "not_member",
  "rate_limited",
] as const;
export type CreditCodeOutcome = (typeof CREDIT_CODE_OUTCOMES)[number];

export interface CreditCodeAttempt {
  outcome: CreditCodeOutcome;
  serverId: string | null;
  limit?: CreditCodeLimit;
  campaign?: string;
  multiUse?: boolean;
  credits?: number;
}

export interface CreditCodeRedemption {
  codeId: string;
  credits: number;
  serverId: string | null;
  campaign: string;
  multiUse: boolean;
}

export interface CreditCodeRedeemInput {
  userId: string;
  sourceIp: string;
  request: CreditRedeemRequest;
  report: (attempt: CreditCodeAttempt) => void;
}

interface CodeRow {
  code_id: string;
  credits_tenths: number;
  max_redemptions: number;
  redemptions: number;
  expires_at: number | null;
  disabled_at: number | null;
  campaign: string;
  redeemed: number;
}

interface Refusal {
  outcome: Exclude<CreditCodeOutcome, "redeemed" | "not_member" | "rate_limited">;
  error: BillingError;
}

export function generateCreditCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CREDIT_CODE_LENGTH));
  return Array.from(bytes, (byte) => CREDIT_CODE_ALPHABET[byte % CREDIT_CODE_ALPHABET.length]).join("");
}

async function hexSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function creditCodeHash(code: string): Promise<string> {
  return hexSha256(normalizeCreditCode(code));
}

function creditCodeNetwork(sourceIp: string): string {
  const value = sourceIp.trim().toLowerCase();
  return value && value.length <= 64 ? value : "unknown";
}

function invalid(): BillingError {
  return new BillingError(404, "credit_code_invalid", sourceText("error.billing.creditCodeInvalid"));
}

function used(): BillingError {
  return new BillingError(409, "credit_code_used", sourceText("error.billing.creditCodeUsed"));
}

function limited(): BillingError {
  return new BillingError(429, "credit_code_attempts", sourceText("error.billing.creditCodeAttempts"));
}

function refusal(row: CodeRow | null, now: number): Refusal | null {
  if (!row) return { outcome: "invalid", error: invalid() };
  if (row.disabled_at !== null) return { outcome: "disabled", error: invalid() };
  if (row.redeemed > 0)
    return {
      outcome: "redeemed_before",
      error: new BillingError(409, "credit_code_redeemed", sourceText("error.billing.creditCodeRedeemed")),
    };
  if (row.expires_at !== null && row.expires_at <= now)
    return {
      outcome: "expired",
      error: new BillingError(410, "credit_code_expired", sourceText("error.billing.creditCodeExpired")),
    };
  if (row.redemptions >= row.max_redemptions) return { outcome: "used_up", error: used() };
  return null;
}

const BUMP_SQL = `INSERT INTO credit_code_limits(key_hash, window_start, count) VALUES (?1, ?2, 1)
  ON CONFLICT(key_hash, window_start) DO UPDATE SET count = count + 1
  RETURNING count`;

const COUNT_SQL = "SELECT count FROM credit_code_limits WHERE key_hash = ?1 AND window_start = ?2";

const NETWORK_TRIES_SQL = `INSERT INTO credit_code_limits(key_hash, window_start, count)
  SELECT ?1, ?2, 1
   WHERE COALESCE((SELECT count FROM credit_code_limits WHERE key_hash = ?3 AND window_start = ?2), 0) <= ?5
     AND COALESCE((SELECT count FROM credit_code_limits WHERE key_hash = ?4 AND window_start = ?2), 0) < ?6
  ON CONFLICT(key_hash, window_start) DO UPDATE SET count = count + 1
  RETURNING count`;

function codeSql(match: "code_hash" | "code_id"): string {
  return `SELECT c.code_id, c.credits_tenths, c.max_redemptions, c.redemptions, c.expires_at, c.disabled_at, c.campaign,
         EXISTS (SELECT 1 FROM credit_code_redemptions r WHERE r.code_id = c.code_id AND r.user_id = ?2) AS redeemed
    FROM credit_codes c WHERE c.${match} = ?1`;
}

const MEMBER_SQL = `SELECT 1 AS member FROM remote_memberships
  WHERE host_id = ?1 AND user_id = ?2 AND status = 'active'`;

const REDEEM_SQL = `INSERT INTO credit_code_redemptions(code_id, user_id, server_id, grant_id, redeemed_at)
  SELECT c.code_id, ?2, ?3, ?4, ?5 FROM credit_codes c
   WHERE c.code_id = ?1 AND c.disabled_at IS NULL AND c.redemptions < c.max_redemptions
     AND (c.expires_at IS NULL OR c.expires_at > ?5)
     AND EXISTS (SELECT 1 FROM users WHERE id = ?2)
     AND (?3 IS NULL OR EXISTS (
       SELECT 1 FROM remote_memberships WHERE host_id = ?3 AND user_id = ?2 AND status = 'active'
     ))
  ON CONFLICT DO NOTHING`;

const REDEMPTIONS_SQL = `UPDATE credit_codes SET redemptions = redemptions + 1
  WHERE code_id = ?1 AND EXISTS (SELECT 1 FROM credit_code_redemptions WHERE grant_id = ?2)`;

const GRANT_SQL = `INSERT INTO credit_grants(
    grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at
  )
  SELECT r.grant_id, CASE WHEN r.server_id IS NULL THEN r.user_id END, r.server_id, c.credits_tenths,
         c.credits_tenths, 'code:' || c.code_id, r.redeemed_at, r.redeemed_at + c.grant_days * ?2, r.redeemed_at
    FROM credit_code_redemptions r JOIN credit_codes c ON c.code_id = r.code_id
   WHERE r.grant_id = ?1`;

const LEDGER_SQL = `INSERT INTO credit_ledger(
    entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
  )
  SELECT 'grant:' || grant_id, user_id, server_id, credits_tenths, 'grant', ?2, grant_id, created_at
    FROM credit_grants WHERE grant_id = ?1`;

const REDEEMED_SQL = "SELECT credits_tenths FROM credit_grants WHERE grant_id = ?1";

function codeFacts(row: CodeRow): { campaign: string; multiUse: boolean } {
  return { campaign: row.campaign, multiUse: row.max_redemptions > 1 };
}

export const redeemCreditCode = Effect.fn("CreditCodes.redeem")(function* (
  database: D1Database,
  now: number,
  input: CreditCodeRedeemInput,
): Effect.fn.Return<CreditCodeRedemption, Failure> {
  const { userId, request, report } = input;
  const serverId = request.serverId ?? null;
  const window = Math.floor(now / CREDIT_CODE_LIMIT_WINDOW_MS) * CREDIT_CODE_LIMIT_WINDOW_MS;
  const network = creditCodeNetwork(input.sourceIp);
  const keys = yield* Effect.promise(async () => ({
    accountTries: await hexSha256(`credit-code:account-tries:${userId}`),
    networkTries: await hexSha256(`credit-code:network-tries:${network}`),
    accountWrong: await hexSha256(`credit-code:account-wrong:${userId}`),
    networkWrong: await hexSha256(`credit-code:network-wrong:${network}`),
  }));
  const refuseLimit = (limit: CreditCodeLimit, row?: CodeRow) => {
    report({ outcome: "rate_limited", serverId, limit, ...(row ? codeFacts(row) : {}) });
    return limited();
  };
  const bump = (keyHash: string) => database.prepare(BUMP_SQL).bind(keyHash, window);
  const counted = (keyHash: string) => database.prepare(COUNT_SQL).bind(keyHash, window);

  const networkTriesBump = database
    .prepare(NETWORK_TRIES_SQL)
    .bind(
      keys.networkTries,
      window,
      keys.accountTries,
      keys.accountWrong,
      CREDIT_CODE_LIMITS.account_tries,
      CREDIT_CODE_LIMITS.account_wrong,
    );
  const [accountTries, accountWrong, networkTries, networkWrong] = yield* billingCall(() =>
    database.batch<{ count: number }>([
      bump(keys.accountTries),
      counted(keys.accountWrong),
      networkTriesBump,
      counted(keys.networkWrong),
    ]),
  );
  const countOf = (result: D1Result<{ count: number }> | undefined) => result?.results[0]?.count ?? 0;
  if (countOf(accountTries) > CREDIT_CODE_LIMITS.account_tries) return yield* refuseLimit("account_tries");
  if (countOf(networkTries) > CREDIT_CODE_LIMITS.network_tries) return yield* refuseLimit("network_tries");
  if (countOf(accountWrong) >= CREDIT_CODE_LIMITS.account_wrong) return yield* refuseLimit("account_wrong");
  if (countOf(networkWrong) >= CREDIT_CODE_LIMITS.network_wrong) return yield* refuseLimit("network_wrong");

  const lookup = (match: "code_hash" | "code_id", value: string) =>
    billingCall(() => database.prepare(codeSql(match)).bind(value, userId).first<CodeRow>());
  const code = normalizeCreditCode(request.code);
  const row = isCreditCode(code) ? yield* lookup("code_hash", yield* Effect.promise(() => creditCodeHash(code))) : null;
  const refused = refusal(row, now);
  if (refused || !row) {
    const failed = refused ?? { outcome: "invalid", error: invalid() };
    if (failed.outcome === "invalid" || failed.outcome === "disabled") {
      yield* billingCall(() => database.batch([bump(keys.accountWrong), bump(keys.networkWrong)]));
    }
    report({ outcome: failed.outcome, serverId, ...(row ? codeFacts(row) : {}) });
    return yield* failed.error;
  }
  if (serverId !== null) {
    const member = yield* billingCall(() => database.prepare(MEMBER_SQL).bind(serverId, userId).first());
    if (!member) {
      report({ outcome: "not_member", serverId, ...codeFacts(row) });
      return yield* new BillingError(403, "credits_server_member", sourceText("error.billing.creditCodeServerMember"));
    }
  }
  const networkCode = yield* Effect.promise(() => hexSha256(`credit-code:network-code:${network}:${row.code_id}`));
  const networkCodeCount = yield* billingCall(() => bump(networkCode).first<{ count: number }>());
  if ((networkCodeCount?.count ?? 0) > CREDIT_CODE_LIMITS.network_code) return yield* refuseLimit("network_code", row);

  const grantId = `code:${row.code_id}:${crypto.randomUUID()}`;
  yield* billingCall(() =>
    database.batch([
      database.prepare(REDEEM_SQL).bind(row.code_id, userId, serverId, grantId, now),
      database.prepare(REDEMPTIONS_SQL).bind(row.code_id, grantId),
      database.prepare(GRANT_SQL).bind(grantId, DAY_MS),
      database.prepare(LEDGER_SQL).bind(grantId, userId),
    ]),
  );
  const granted = yield* billingCall(() =>
    database.prepare(REDEEMED_SQL).bind(grantId).first<{ credits_tenths: number }>(),
  );
  if (granted) {
    const credits = creditsFromTenths(granted.credits_tenths);
    report({ outcome: "redeemed", serverId, credits, ...codeFacts(row) });
    return { codeId: row.code_id, credits, serverId, ...codeFacts(row) };
  }
  const after = yield* lookup("code_id", row.code_id);
  const lost = refusal(after, now) ?? { outcome: "used_up", error: used() };
  report({ outcome: lost.outcome, serverId, ...codeFacts(row) });
  return yield* lost.error;
});
