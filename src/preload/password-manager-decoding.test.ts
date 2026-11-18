import { describe, expect, it } from "vitest";
import {
  decodePasswordManagerChange,
  decodePasswordManagerResponse,
  decodePasswordManagerResponses,
} from "./password-manager-decoding";

// A status never holds a key or a password, and the sign-in page is kept only while a sign-in runs.
// A response for a manager that this build does not know is refused; its event is dropped.
describe("password manager decoding", () => {
  const signingIn = {
    manager: "protonpass",
    state: "signing-in",
    step: "browser",
    methods: ["browser", "key"],
    signInUrl: "https://account.proton.me/authorize?code=1",
    vaultNames: [],
    loginCount: null,
    expiresAt: null,
    error: null,
    errorCode: null,
  };
  const connected = {
    ...signingIn,
    state: "connected",
    step: null,
    signInUrl: null,
    vaultNames: ["Shared with OpenBot"],
    loginCount: 12,
    expiresAt: 1_800_000_000_000,
  };

  it.each([
    ["a sign-in", signingIn],
    ["a connection", connected],
  ])("keeps %s unchanged", (_name, value) => {
    expect(decodePasswordManagerResponse(value)).toEqual(value);
    expect(decodePasswordManagerResponses([value])).toEqual([value]);
  });

  it("drops a field main did not name", () => {
    expect(decodePasswordManagerResponse({ ...connected, key: "pst_secret" })).toEqual(connected);
  });

  it("drops the sign-in page when no sign-in runs", () => {
    expect(decodePasswordManagerResponse({ ...connected, signInUrl: "https://account.proton.me/" })).toEqual(connected);
  });

  it("leaves out a step, a method and an error code that it does not know", () => {
    expect(
      decodePasswordManagerResponse({ ...signingIn, step: "scan", methods: ["browser", "qr"], errorCode: "quota" }),
    ).toEqual({ ...signingIn, step: null, methods: ["browser"], errorCode: null });
  });

  it("shows a state that it does not know as not connected", () => {
    expect(decodePasswordManagerResponse({ ...connected, state: "paused" })).toMatchObject({
      state: "disconnected",
      step: null,
      signInUrl: null,
    });
  });

  it("refuses a manager that it does not know, and drops its event", () => {
    expect(decodePasswordManagerChange({ ...connected, manager: "keeper" })).toBeNull();
    expect(() => decodePasswordManagerResponses([{ ...connected, manager: "keeper" }, connected])).toThrow(/^Invalid /);
    expect(() => decodePasswordManagerResponse({ ...connected, manager: "keeper" })).toThrow(/^Invalid /);
  });

  it.each([
    ["no status", null],
    ["a login count below zero", { ...connected, loginCount: -1 }],
    ["a vault name that is not text", { ...connected, vaultNames: [1] }],
    ["a sign-in page that is not text", { ...signingIn, signInUrl: 1 }],
    ["no methods", { ...connected, methods: undefined }],
  ])("refuses %s", (_name, value) => {
    expect(() => decodePasswordManagerResponse(value)).toThrow(/^Invalid /);
  });

  it("refuses a list that is not a list", () => {
    expect(() => decodePasswordManagerResponses({ managers: [] })).toThrow(/^Invalid /);
  });
});
