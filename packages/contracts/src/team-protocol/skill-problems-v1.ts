// Frozen optional skill-problems-v1 contract.
//
// What it grants, recorded here because freezing it makes it permanent: a client that sends it can
// show a skill that an agent cannot use. `GET /v1/agents/:agentId/skills` then also lists each skill
// folder of the agent whose `SKILL.md` has a problem, with the reason in its `problem` field, so the
// `$` picker can say why the skill is not there. Without it, the host leaves those skills out, as
// before. The list keeps the frozen item shape. A protocol 9 capability only. Widening any of it
// needs a second capability string.

export const SKILL_PROBLEMS_CAPABILITY = "skill-problems-v1";
