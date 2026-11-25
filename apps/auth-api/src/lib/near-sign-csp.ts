export const NEAR_SIGN_PATH = "/near/sign";
export const NEAR_PASSKEY_WALLET_HOST = "nearintents.openbot.run";

export function passkeyWalletHostResponse(request: Request, siteUrl: string): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== NEAR_PASSKEY_WALLET_HOST || url.pathname === NEAR_SIGN_PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 404 });
  return Response.redirect(siteUrl, 308);
}

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
