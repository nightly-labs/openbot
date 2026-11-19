import { adminRoute, fields, list, type OptionalRouteCodec, string } from "./admin-wire";

export const GITHUB_SKILLS_CAPABILITY = "github-skills-v1";

export const GITHUB_SKILLS_ROUTES = {
  read: "/v1/admin/skills/github/read",
} as const;

const skill = fields({
  id: string(256),
  path: string(256),
  slug: string(256),
  name: string(256),
  description: string(1024),
  instructions: string(131_072),
  files: list(string(1024), 200),
});

export const GITHUB_SKILLS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    GITHUB_SKILLS_ROUTES.read,
    adminRoute(
      fields({ link: string(2048) }),
      fields({
        owner: string(64),
        repo: string(128),
        commit: string(64),
        committedAt: string(64),
        path: string(1024),
        skills: list(skill, 100),
      }),
    ),
  ],
]);
