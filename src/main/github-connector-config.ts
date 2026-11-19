const GITHUB_APP_CLIENT_ID = "Iv23lik5pzHz70cb0RUL";
const GITHUB_APP_SLUG = "openbotgit";

export interface GitHubAppConfig {
  clientId: string;
  slug: string;
}

export function githubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig | null {
  const clientId = env.OPENBOT_GITHUB_CLIENT_ID?.trim() || GITHUB_APP_CLIENT_ID;
  const slug = env.OPENBOT_GITHUB_APP_SLUG?.trim() || GITHUB_APP_SLUG;
  if (!/^[A-Za-z0-9.]+$/u.test(clientId) || !/^[a-z0-9-]+$/u.test(slug)) return null;
  return { clientId, slug };
}
