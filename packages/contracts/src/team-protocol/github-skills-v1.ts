// Frozen optional github-skills-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can ask the host to read a link to a public GitHub repository, folder or `SKILL.md`. The
// host reads it with no GitHub account, pins the commit it read, and answers with the skill folders
// under the link and the text of each `SKILL.md`. Each skill id names that commit
// (`github:<owner>/<repo>@<commit>:<folder>`). With this capability, the `skills-admin-v1` install
// route also takes such an id: the host downloads the files of that commit itself, so a client
// never sends skill files. A host that did not negotiate this capability refuses the id. A member
// cannot use the route; `requireAdmin` on the host is the only gate. Widening any of it needs a
// second capability string.
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
