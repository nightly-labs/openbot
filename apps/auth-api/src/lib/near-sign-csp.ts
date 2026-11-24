export const NEAR_SIGN_PATH = "/near/sign";

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
