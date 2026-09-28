import { describe, expect, it } from "vitest";
import {
  APPLE_APP_SITE_ASSOCIATION,
  createAppleAppSiteAssociationResponse,
} from "../src/routes/[.]well-known/apple-app-site-association";

describe("Apple app site association", () => {
  it("associates invitations with both signed apps and shared agents with the mobile app only", async () => {
    const response = createAppleAppSiteAssociationResponse();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    await expect(response.json()).resolves.toEqual(APPLE_APP_SITE_ASSOCIATION);
    expect(APPLE_APP_SITE_ASSOCIATION.applinks.details).toEqual([
      {
        appID: "ZTRDTUL87R.app.openbot.desktop",
        paths: ["/join"],
      },
      {
        appID: "ZTRDTUL87R.run.openbot.mobile",
        paths: ["/join", "/agents/*"],
      },
    ]);
  });
});
