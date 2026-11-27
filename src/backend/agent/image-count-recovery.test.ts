import { describe, expect, it } from "vitest";
import { renderProviderHandoff } from "./handoff-history";
import { refusedSessionFailure } from "./thread-items";

describe("image count recovery", () => {
  it("does not tell the user to retry a chat the model already refused for too many images", () => {
    const text = refusedSessionFailure("opencode", "too many images in the request");
    expect(text).toContain("left those images out");
    expect(text).toContain("does not clear the limit");
    expect(text).not.toContain("Try again");
  });

  it("still says a new session does not help when the same chat hits the limit again", () => {
    const text = refusedSessionFailure("opencode", "Request has more images than the maximum of 20", null, true);
    expect(text).toContain("a new session does not help");
    expect(text).not.toContain("Try again");
  });

  it("tells the replacement session that the old images were omitted", () => {
    const handoff = renderProviderHandoff(
      { recent: [], latest: [], hasOlder: false, resetMessageId: null },
      new Map(),
      new Map(),
      { omitImages: true },
    );
    expect(handoff).toContain("Images from the previous session were omitted");
    expect(handoff).toContain("Open at most one image");
  });
});
