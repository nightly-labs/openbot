import { describe, expect, it } from "vitest";
import { dayMarkerLabel } from "./chat-day-markers";

const now = new Date(2026, 8, 9, 14, 0);
const options = { now, locale: "en-US" };

describe("dayMarkerLabel", () => {
  it("gives the first message a separator", () => {
    expect(dayMarkerLabel(undefined, new Date(2026, 8, 9, 12, 59).toISOString(), options)).toBe("Today 12:59 PM");
  });

  it("gives no separator to a second message on the same day", () => {
    expect(
      dayMarkerLabel(new Date(2026, 8, 9, 12, 59).toISOString(), new Date(2026, 8, 9, 23, 30).toISOString(), options),
    ).toBeNull();
  });

  it("separates a message that crosses midnight", () => {
    expect(
      dayMarkerLabel(new Date(2026, 8, 8, 23, 59).toISOString(), new Date(2026, 8, 9, 0, 1).toISOString(), options),
    ).toBe("Today 12:01 AM");
  });

  it("names yesterday", () => {
    expect(
      dayMarkerLabel(new Date(2026, 8, 7, 10, 0).toISOString(), new Date(2026, 8, 8, 11, 12).toISOString(), options),
    ).toBe("Yesterday 11:12 AM");
  });

  it("names the date of an older day", () => {
    expect(dayMarkerLabel(undefined, new Date(2026, 8, 7, 23, 12).toISOString(), options)).toBe("Mon, Sep 7 11:12 PM");
  });

  it("gives no separator for an unreadable timestamp", () => {
    expect(dayMarkerLabel(undefined, "not a time", options)).toBeNull();
  });
});
