export function cloudflareAccessHeaders(environment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const clientId = environment.CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = environment.CF_ACCESS_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret } : {};
}
