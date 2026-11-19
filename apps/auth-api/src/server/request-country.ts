/**
 * The country of the visitor, as Cloudflare finds it from the IP address. Cloudflare adds `CF-IPCountry`
 * only to a request that goes to an origin, not to a Worker request, so the deployed Worker reads
 * `request.cf.country`. Cloudflare removes a `CF-IPCountry` header that a client sends, so the header
 * comes first only for a local Worker, where a test sends it. Cloudflare sends XX for an unknown
 * country and T1 for Tor.
 *
 * The Node type check also sees this file, and its `Request` has no `cf`, so the checks use `in`.
 */
export function requestCountry(request: Request): string | undefined {
  const header = request.headers.get("cf-ipcountry");
  if (header) return header;
  const cf = "cf" in request ? request.cf : undefined;
  return typeof cf === "object" && cf !== null && "country" in cf && typeof cf.country === "string"
    ? cf.country
    : undefined;
}
