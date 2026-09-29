import { describe, expect, it } from "vitest";
import { readHeadlessMode } from "./headless-mode";

describe("headless mode", () => {
  it("stays off unless the operator asks for it", () => {
    expect(readHeadlessMode({}, [])).toBe(false);
    expect(readHeadlessMode({ OPENBOT_HEADLESS: "0" }, ["--openbot-headless"])).toBe(false);
    expect(readHeadlessMode({ OPENBOT_HEADLESS: "false" }, [])).toBe(false);
    expect(readHeadlessMode({ OPENBOT_HEADLESS: "" }, [])).toBe(false);
  });

  it("accepts an explicit environment value or the OpenBot switch", () => {
    expect(readHeadlessMode({ OPENBOT_HEADLESS: "1" }, [])).toBe(true);
    expect(readHeadlessMode({ OPENBOT_HEADLESS: " yes " }, [])).toBe(true);
    expect(readHeadlessMode({}, ["--openbot-headless"])).toBe(true);
  });

  it("does not treat Chromium's own headless switch as this mode", () => {
    expect(readHeadlessMode({}, ["--headless"])).toBe(false);
  });
});
