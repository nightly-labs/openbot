import { randomBytes } from "node:crypto";
import { BROWSER_PROXY_SCHEMES, type BrowserProxyScheme } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import {
  checkedColumn,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** A saved proxy address without its password. */
export interface BrowserProxyAddressRecord {
  kind: "address";
  id: string;
  scheme: BrowserProxyScheme;
  host: string;
  port: number;
  username: string | null;
  hasPassword: boolean;
}

/** The computer of one member: the pages go out through the OpenBot desktop app of that member. */
export interface BrowserProxyComputerRecord {
  kind: "computer";
  id: string;
  memberId: string;
}

export type BrowserProxyRecord = BrowserProxyAddressRecord | BrowserProxyComputerRecord;

/** A proxy as the browser connects to it. The password is plain text: it never leaves main. */
export type BrowserProxyConnection =
  | {
      kind: "address";
      proxyId: string;
      scheme: BrowserProxyScheme;
      host: string;
      port: number;
      username: string | null;
      password: string | null;
    }
  | { kind: "computer"; proxyId: string; memberId: string };

/** The columns of a new or changed proxy. The password is already encrypted. */
export interface BrowserProxyRow {
  scheme: BrowserProxyScheme;
  host: string;
  port: number;
  username: string | null;
  password: Uint8Array | null;
}

/**
 * Owns the `browser_proxies` rows and the proxy of each named profile. It stores the password as the
 * caller encrypted it, and reads it back only in `connection`. Configuration, so it writes directly,
 * as `BrowserProfileStore` does.
 */
export class BrowserProxyStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  list(): BrowserProxyRecord[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT ${RECORD_COLUMNS} FROM browser_proxies
           ORDER BY kind, host COLLATE NOCASE, port, created_at, proxy_id`,
        )
        .all(),
    ).map(proxyRecord);
  }

  get(id: string): BrowserProxyRecord | undefined {
    const [row] = databaseRows(
      this.#database.connection.prepare(`SELECT ${RECORD_COLUMNS} FROM browser_proxies WHERE proxy_id = ?`).all(id),
    );
    return row === undefined ? undefined : proxyRecord(row);
  }

  /** The computer of a member, added when it is not there yet. */
  ensureComputer(memberId: string): BrowserProxyComputerRecord {
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO browser_proxies (proxy_id, kind, member_id, created_at, updated_at)
         VALUES (?, 'computer', ?, ?, ?)
         ON CONFLICT(member_id) WHERE kind = 'computer' DO NOTHING`,
      )
      .run(randomBytes(16).toString("hex"), memberId, now, now);
    const row = this.#database.connection
      .prepare("SELECT proxy_id FROM browser_proxies WHERE kind = 'computer' AND member_id = ?")
      .get(memberId);
    const id = row?.proxy_id;
    if (typeof id !== "string") throw new Error("The computer proxy was not saved.");
    return { kind: "computer", id, memberId };
  }

  /** The encrypted password of a proxy, or null. */
  password(id: string): Uint8Array | null {
    const row = this.#database.connection.prepare("SELECT password FROM browser_proxies WHERE proxy_id = ?").get(id);
    const value = row?.password;
    return value instanceof Uint8Array ? value : null;
  }

  /** The proxy of each named profile that has one, by profile id. */
  assignments(): Map<string, string> {
    return new Map(
      databaseRows(
        this.#database.connection.prepare("SELECT profile_id, proxy_id FROM browser_profile_proxies").all(),
      ).map((row) => [requiredStringColumn(row, "profile_id"), requiredStringColumn(row, "proxy_id")]),
    );
  }

  /** The proxy of one named profile, or undefined for the proxy settings of the computer. */
  proxyOfProfile(profileId: string): string | undefined {
    const row = this.#database.connection
      .prepare("SELECT proxy_id FROM browser_profile_proxies WHERE profile_id = ?")
      .get(profileId);
    const value = row?.proxy_id;
    return typeof value === "string" ? value : undefined;
  }

  /** Adds a proxy address with a new random id. The caller checks the limit and the address. */
  create(row: BrowserProxyRow): string {
    const id = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO browser_proxies (proxy_id, scheme, host, port, username, password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, row.scheme, row.host, row.port, row.username, row.password, now, now);
    return id;
  }

  update(id: string, row: BrowserProxyRow): void {
    this.#database.connection
      .prepare(
        `UPDATE browser_proxies SET scheme = ?, host = ?, port = ?, username = ?, password = ?, updated_at = ?
         WHERE proxy_id = ? AND kind = 'address'`,
      )
      .run(row.scheme, row.host, row.port, row.username, row.password, new Date().toISOString(), id);
  }

  /** Deletes the proxy. Its profiles go back to the proxy settings of the computer. */
  delete(id: string): void {
    this.#database.connection.prepare("DELETE FROM browser_proxies WHERE proxy_id = ?").run(id);
  }

  /** Null: the profile uses the proxy settings of the computer. */
  assign(profileId: string, proxyId: string | null): void {
    if (proxyId === null) {
      this.#database.connection.prepare("DELETE FROM browser_profile_proxies WHERE profile_id = ?").run(profileId);
      return;
    }
    this.#database.connection
      .prepare(
        `INSERT INTO browser_profile_proxies (profile_id, proxy_id) VALUES (?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET proxy_id = excluded.proxy_id`,
      )
      .run(profileId, proxyId);
  }
}

const RECORD_COLUMNS = "proxy_id, kind, scheme, host, port, username, password IS NOT NULL AS has_password, member_id";
const KINDS = ["address", "computer"] as const;

function proxyRecord(row: DynamicRecord): BrowserProxyRecord {
  if (checkedColumn(row, "kind", KINDS) === "computer")
    return {
      kind: "computer",
      id: requiredStringColumn(row, "proxy_id"),
      memberId: requiredStringColumn(row, "member_id"),
    };
  return {
    kind: "address",
    id: requiredStringColumn(row, "proxy_id"),
    scheme: checkedColumn(row, "scheme", BROWSER_PROXY_SCHEMES),
    host: requiredStringColumn(row, "host"),
    port: requiredNumberColumn(row, "port"),
    username: optionalStringColumn(row, "username"),
    hasPassword: requiredNumberColumn(row, "has_password") === 1,
  };
}
