import { describe, expect, it } from "vitest";
import { acpUserMeta, authenticatedBatchUser } from "./acp-user-meta";

describe("authenticated ACP user metadata", () => {
  it("uses the member only when every message has the same authenticated sender", () => {
    expect(
      authenticatedBatchUser([
        { kind: "user", id: "member-a" },
        { kind: "user", id: "member-a" },
      ]),
    ).toBe("member-a");
    expect(acpUserMeta("member-a")).toEqual({ "openbot.dev/userId": "member-a" });
  });
  it("omits the user for mixed or missing senders", () => {
    expect(
      authenticatedBatchUser([
        { kind: "user", id: "a" },
        { kind: "user", id: "b" },
      ]),
    ).toBeUndefined();
    expect(authenticatedBatchUser([{ kind: "user", id: "a" }, { kind: "user" }])).toBeUndefined();
    expect(authenticatedBatchUser([{ kind: "routine", id: "a" }])).toBeUndefined();
    expect(authenticatedBatchUser([])).toBeUndefined();
    expect(acpUserMeta(undefined)).toBeUndefined();
  });
});
