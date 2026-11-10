/** The path of the NEAR wallet signing page. `src/main/near-wallet-signing.ts` opens it. */
export const NEAR_SIGN_PATH = "/near/sign";

/**
 * The headers of the NEAR wallet signing page. The page holds a signature request, so no cache,
 * frame, referrer or search engine gets it, and only the site's own code runs on it.
 *
 * - `script-src` takes the site's bundle and the inline scripts with this request's nonce: the
 *   router state and Solid's hydration. No `unsafe-eval` and no other origin.
 * - `style-src` keeps `unsafe-inline`: the shared site header renders `style` attributes.
 * - `connect-src 'self'`: the router loads the catalog and route chunks from this site only. The page
 *   itself sends nothing.
 * - `form-action 'none'` and `base-uri 'none'`: the page has no form and no `<base>`.
 *
 * Without a nonce (a render that is not on this path) the policy allows no inline script, and the page
 * does not start, which is safe.
 */
export function nearSignHeaders(nonce: string | undefined): Record<string, string> {
  const scripts = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src ${scripts}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join("; "),
    "Permissions-Policy":
      "camera=(), geolocation=(), microphone=(), payment=(), usb=(), publickey-credentials-create=(self), publickey-credentials-get=(self)",
  };
}
