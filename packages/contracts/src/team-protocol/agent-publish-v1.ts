// Frozen optional agent-publish-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read what the host would publish for one of its agents, publish it as a link-only
// agent template, update it and unpublish it. The host builds the template, refuses secrets and
// uploads it with the account signed in on it, as when it is published on the host, so the
// template belongs to that account. A client never sends instructions, skills or routines: it
// sends the agent id and, optionally, the share card it drew from the preview. A member cannot use
// any route; `requireAdmin` on the host is the only gate. Widening any of it needs a second
// capability string.
//
// Bytes travel as base64. The avatar is at most 512 KiB, and so is the card, because a request body
// of the host is at most 1 MiB; a client publishes without a larger card.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const AGENT_PUBLISH_CAPABILITY = "agent-publish-v1";

export const AGENT_PUBLISH_ROUTES = {
  preview: "/v1/admin/agents/template-preview",
  publish: "/v1/admin/agents/template-publish",
  unpublish: "/v1/admin/agents/template-unpublish",
} as const;

/** The largest avatar or card, in bytes. */
export const AGENT_PUBLISH_IMAGE_BYTES = 524_288;

/** Base64 of 512 KiB: `ceil(524288 / 3) * 4`. */
const IMAGE_BASE64_LIMIT = 699_052;

const kind = (name: string) => ({ kind: oneOf(name) });
const time = string(5);

const skill = variant({
  marketplace: fields({
    ...kind("marketplace"),
    skillId: string(256),
    versionId: string(256),
    slug: string(256),
    name: string(256),
    version: count,
  }),
  embedded: fields({ ...kind("embedded"), slug: string(64), name: string(256), markdown: string(65_536) }),
});

const schedule = variant({
  hourly: fields({ ...kind("hourly"), minute: count }),
  daily: fields({ ...kind("daily"), time }),
  weekdays: fields({ ...kind("weekdays"), time }),
  weekly: fields({ ...kind("weekly"), weekday: count, time }),
  monthly: fields({ ...kind("monthly"), day: count, time }),
  interval: fields({
    ...kind("interval"),
    amount: count,
    unit: oneOf("minutes", "hours", "days"),
    anchorAt: string(64),
  }),
  advanced: fields({
    ...kind("advanced"),
    months: list(count, 12),
    days: variant({
      "every-day": fields(kind("every-day")),
      "days-of-week": fields({ ...kind("days-of-week"), days: list(count, 7) }),
      "days-of-month": fields({ ...kind("days-of-month"), days: list(count, 31) }),
    }),
    time: variant({
      "at-time": fields({ ...kind("at-time"), time }),
      every: fields({ ...kind("every"), amount: count, unit: oneOf("minutes", "hours") }),
    }),
  }),
  custom: fields({ ...kind("custom"), expression: string(255) }),
});

const routine = fields({ name: string(256), instruction: string(100_000), active: boolean, schedule });

const publication = fields({ templateId: identifier, shareUrl: string(2_048), publishedAt: string(64) });

const preview = fields({
  agentId: identifier,
  name: string(256),
  title: string(256),
  description: string(100_000),
  avatarSeed: string(128),
  avatarHue: nullable(count),
  avatarImage: nullable(
    fields({ mimeType: oneOf("image/png", "image/jpeg", "image/webp"), data: string(IMAGE_BASE64_LIMIT) }),
  ),
  skills: list(skill, 64),
  routines: list(routine, 128),
  updatedAt: nullable(string(64)),
  publication: nullable(publication),
  skillsError: nullable(string(4_096)),
});

export const AGENT_PUBLISH_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_PUBLISH_ROUTES.preview, adminRoute(fields({ agentId: identifier }), preview)],
  [
    AGENT_PUBLISH_ROUTES.publish,
    adminRoute(fields({ agentId: identifier, card: nullable(string(IMAGE_BASE64_LIMIT)) }), publication),
  ],
  [AGENT_PUBLISH_ROUTES.unpublish, adminRoute(fields({ agentId: identifier }), empty)],
]);
