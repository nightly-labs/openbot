import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_PLUGINS } from "../src/lib/plugins";
import { pluginIconResponse } from "../src/server/plugin-icon";

afterEach(() => {
  vi.unstubAllGlobals();
});

const plugin = SITE_PLUGINS[0];
if (!plugin) throw new Error("The catalog must hold at least one plugin.");

/** Records every address the handler reaches for, which is the point of most of these tests. */
function stubFetch(response: Response) {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return response;
  });
  return fetched;
}

const png = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });

describe("plugin icon route", () => {
  /* The whole reason the route exists: a reader of a plugin page asks openbot.run for the picture,
     and the address of the developer's own server is read here, from the catalog. */
  it("fetches the address the catalog holds for the listing", async () => {
    const fetched = stubFetch(png());

    const response = await pluginIconResponse(plugin.slug, null);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(fetched).toEqual([plugin.iconUrl]);
  });

  /* The slug is the only thing a reader controls, so it must never become an address. A slug the
     catalog does not hold has no icon and nothing is fetched at all. */
  it("fetches nothing for a slug the catalog does not hold", async () => {
    const fetched = stubFetch(png());

    const response = await pluginIconResponse("https://example.com/private", null);

    expect(response.status).toBe(404);
    expect(fetched).toEqual([]);
  });

  /* An SVG runs as the origin that serves it, and this route serves from openbot.run. A listing
     whose icon became one would otherwise be a way to run code on the site. */
  it("refuses to serve an icon that answers as SVG", async () => {
    stubFetch(new Response("<svg onload='alert(1)' />", { headers: { "Content-Type": "image/svg+xml" } }));

    const response = await pluginIconResponse(plugin.slug, null);

    expect(response.status).toBe(404);
  });

  it("answers 404 when the developer's server does not", async () => {
    stubFetch(new Response("nope", { status: 500, headers: { "Content-Type": "text/plain" } }));

    const response = await pluginIconResponse(plugin.slug, null);

    expect(response.status).toBe(404);
  });

  /* An app carries its own icon, and the id that names it comes from the same catalog entry. */
  it("serves an app's own icon, and nothing for an app the listing does not hold", async () => {
    const app = plugin.apps[0];
    if (!app?.iconUrl) throw new Error("The first listing must hold an app with an icon.");
    const fetched = stubFetch(png());

    expect((await pluginIconResponse(plugin.slug, app.id)).status).toBe(200);
    expect(fetched).toEqual([app.iconUrl]);

    expect((await pluginIconResponse(plugin.slug, "not-an-app")).status).toBe(404);
    expect(fetched).toHaveLength(1);
  });
});
