import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BillingUsd, BillingUsdError } from "../src/server/billing-usd";
import { runApiEffect } from "../src/server/effect-runtime";
import { sqliteD1 } from "./sqlite-d1";

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time="2024-01-05">
      <Cube rate="1.0950" currency="USD"></Cube>
      <Cube currency="PLN" rate="4.3700"></Cube>
    </Cube>
    <Cube time="2024-01-08">
      <Cube currency="USD" rate="1.0960"></Cube>
      <Cube rate="4.3600" currency="PLN"></Cube>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

function database(): D1Database {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE billing_fx_rates (
      day TEXT NOT NULL,
      currency TEXT NOT NULL,
      usd_rate REAL NOT NULL,
      PRIMARY KEY (day, currency)
    )
  `);
  return sqliteD1(raw);
}

function timestamp(day: string): number {
  return Date.parse(`${day}T12:00:00.000Z`) / 1_000;
}

function ecbFetch(xml: string = ECB_XML): (input: string, init: RequestInit) => Promise<Response> {
  return vi.fn(
    async (_input: string, _init: RequestInit) => new Response(xml, { headers: { "content-type": "application/xml" } }),
  );
}

describe("BillingUsd", () => {
  it("leaves USD cents unchanged without reading rates", async () => {
    const fetch = ecbFetch();
    const result = await runApiEffect(
      new BillingUsd({ database: database(), fetch }).convert(1_234, "usd", timestamp("2024-01-07")),
    );

    expect(result).toEqual({ amountUsd: 1_234, fxDate: "2024-01-07", fxRate: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the latest ECB day on or before a weekend payment", async () => {
    const result = await runApiEffect(
      new BillingUsd({ database: database(), fetch: ecbFetch() }).convert(1_000, "eur", timestamp("2024-01-07")),
    );

    expect(result).toEqual({ amountUsd: 1_095, fxDate: "2024-01-05", fxRate: 1.095 });
  });

  it("converts PLN with the EUR-base cross rate and caches the source day", async () => {
    const fetch = ecbFetch();
    const service = new BillingUsd({ database: database(), fetch });
    const result = await runApiEffect(service.convert(1_000, "pln", timestamp("2024-01-05")));
    const cached = await runApiEffect(service.convert(1_000, "pln", timestamp("2024-01-05")));

    expect(result).toEqual({ amountUsd: 251, fxDate: "2024-01-05", fxRate: 1.095 / 4.37 });
    expect(cached).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses a cached exact-date rate without calling ECB", async () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec(`
      CREATE TABLE billing_fx_rates (
        day TEXT NOT NULL,
        currency TEXT NOT NULL,
        usd_rate REAL NOT NULL,
        PRIMARY KEY (day, currency)
      );
      INSERT INTO billing_fx_rates(day, currency, usd_rate) VALUES ('2024-01-05', 'eur', 1.095)
    `);
    const fetch = ecbFetch();
    const result = await runApiEffect(
      new BillingUsd({ database: sqliteD1(raw), fetch }).convert(1_000, "eur", timestamp("2024-01-05")),
    );

    expect(result).toEqual({ amountUsd: 1_095, fxDate: "2024-01-05", fxRate: 1.095 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["network", () => Promise.reject(new Error("offline"))],
    ["response", async () => new Response("", { status: 503 })],
    ["document", async () => new Response("<broken")],
  ] as const)("returns a safe %s error", async (reason, fetch) => {
    const error = await runApiEffect(
      Effect.flip(new BillingUsd({ database: database(), fetch }).convert(1_000, "eur", timestamp("2024-01-05"))),
    );

    expect(error).toBeInstanceOf(BillingUsdError);
    expect(error.reason).toBe(reason);
  });

  it("does not invent a rate when the document has no earlier quote", async () => {
    const error = await runApiEffect(
      Effect.flip(
        new BillingUsd({ database: database(), fetch: ecbFetch() }).convert(1_000, "eur", timestamp("2020-01-01")),
      ),
    );

    expect(error).toMatchObject({ _tag: "BillingUsdError", reason: "missing_rate" });
  });

  it("rejects invalid amount and timestamp values", async () => {
    const service = new BillingUsd({ database: database(), fetch: ecbFetch() });
    await expect(runApiEffect(Effect.flip(service.convert(-1, "eur", timestamp("2024-01-05"))))).resolves.toMatchObject(
      {
        reason: "invalid_input",
      },
    );
    await expect(runApiEffect(Effect.flip(service.convert(1, "eur", 0)))).resolves.toMatchObject({
      reason: "invalid_input",
    });
  });
});
