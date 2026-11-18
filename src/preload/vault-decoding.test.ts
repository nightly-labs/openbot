// @vitest-environment node

import { describe, expect, it } from "vitest";
import { decodeVaultCodes, decodeVaultImportResult, decodeVaultState } from "./vault-decoding";

const LOGIN = {
  id: "l1",
  kind: "login",
  website: "github.com",
  username: "ada",
  notes: "",
  hasPassword: true,
  hasTwoStep: true,
};
const CARD = {
  id: "c1",
  kind: "card",
  label: "Work",
  nameOnCard: "Ada Lovelace",
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: 2034,
  billingContactId: null,
  fillSites: ["https://shop.example"],
};
const CONTACT = {
  id: "p1",
  kind: "contact",
  label: "Home",
  fullName: "Ada Lovelace",
  address: "1 Main St",
  address2: "",
  city: "London",
  region: "",
  postalCode: "N1",
  country: "GB",
  phone: "",
  email: "ada@example.com",
};
const API_KEY = { id: "k1", kind: "apiKey", name: "OPENAI_API_KEY", notes: "", hasKey: true };

describe("decodeVaultState", () => {
  it("keeps the summaries of every item kind", () => {
    const state = { status: "ready", items: [LOGIN, CARD, CONTACT, API_KEY] };
    expect(decodeVaultState(state)).toEqual(state);
  });

  it.each([
    ["a login password", { ...LOGIN, password: "hunter2" }],
    ["a card number", { ...CARD, number: "4242424242424242" }],
    ["a security code", { ...CARD, securityCode: "123" }],
    ["an API key", { ...API_KEY, key: "sk-test-1234567890" }],
    ["a two-step key", { ...LOGIN, twoStepKey: "JBSWY3DPEHPK3PXP" }],
  ])("refuses a summary that carries %s", (_name, item) => {
    expect(() => decodeVaultState({ status: "ready", items: [item] })).toThrow();
  });

  it("keeps the name of the agent that added an item", () => {
    const state = { status: "ready", items: [{ ...CONTACT, addedBy: "Atlas" }] };
    expect(decodeVaultState(state)).toEqual(state);
    expect(() => decodeVaultState({ status: "ready", items: [{ ...LOGIN, addedBy: 7 }] })).toThrow();
  });

  it("keeps the agents of an item and whether the Vault keeps them", () => {
    const state = { status: "ready", items: [{ ...API_KEY, agents: ["a1", "a2"] }, LOGIN], agentScope: true };
    expect(decodeVaultState(state)).toEqual(state);
    expect(() => decodeVaultState({ status: "ready", items: [{ ...LOGIN, agents: "a1" }] })).toThrow();
    expect(() => decodeVaultState({ status: "ready", items: [{ ...LOGIN, agents: [1] }] })).toThrow();
    expect(() => decodeVaultState({ status: "ready", items: [], agentScope: "yes" })).toThrow();
  });

  it("refuses a card whose last four are not four digits", () => {
    expect(() => decodeVaultState({ status: "ready", items: [{ ...CARD, last4: "4242424242424242" }] })).toThrow();
  });

  it("refuses an unknown status, kind or brand", () => {
    expect(() => decodeVaultState({ status: "open", items: [] })).toThrow();
    expect(() => decodeVaultState({ status: "ready", items: [{ ...LOGIN, kind: "note" }] })).toThrow();
    expect(() => decodeVaultState({ status: "ready", items: [{ ...CARD, brand: "jcb" }] })).toThrow();
  });
});

describe("decodeVaultCodes", () => {
  it("keeps the codes", () => {
    const codes = { codes: [{ id: "l1", code: "287082", period: 30, remainingMs: 12_000 }] };
    expect(decodeVaultCodes(codes)).toEqual(codes);
  });

  it("refuses a code that is not 6 to 8 digits, such as a key", () => {
    for (const code of ["12345", "123456789", "JBSWY3DPEHPK3PXP"])
      expect(() => decodeVaultCodes({ codes: [{ id: "l1", code, period: 30, remainingMs: 1 }] })).toThrow();
  });
});

describe("decodeVaultImportResult", () => {
  it("keeps null for a closed file dialog", () => {
    expect(decodeVaultImportResult(null)).toBeNull();
  });

  it("decodes the counts and refuses a state with a secret", () => {
    const state = { status: "ready", items: [LOGIN] };
    expect(decodeVaultImportResult({ imported: 2, skipped: 1, state })).toEqual({ imported: 2, skipped: 1, state });
    expect(() =>
      decodeVaultImportResult({
        imported: 1,
        skipped: 0,
        state: { status: "ready", items: [{ ...LOGIN, password: "x" }] },
      }),
    ).toThrow();
  });
});
