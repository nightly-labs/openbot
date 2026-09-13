import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";
import {
  createSkillSchema,
  installLocalSkillSchema,
  readSkillSchema,
  reviseSkillSchema,
} from "../../backend/agent/skill-tools";

const agentId = z.string().min(1).max(INPUT_LIMITS.identifier);
export const parseCreateLocalSkill = (input: unknown) => createSkillSchema.extend({ agentId }).parse(input);
export const parseReviseLocalSkill = (input: unknown) => reviseSkillSchema.extend({ agentId }).parse(input);
export const parseReadLocalSkill = (input: unknown) => readSkillSchema.parse(input);
export const parseInstallLocalSkill = (input: unknown) => installLocalSkillSchema.extend({ agentId }).parse(input);
