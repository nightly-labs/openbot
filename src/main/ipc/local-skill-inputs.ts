import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CreateLocalSkillInput,
  InstallLocalSkillInput,
  LocalSkillRevisionInput,
  ReviseLocalSkillInput,
  SetLocalSkillGlobalInput,
} from "@openbot/contracts/ipc";
import { z } from "zod";
import {
  createSkillSchema,
  installLocalSkillSchema,
  readSkillSchema,
  reviseSkillSchema,
} from "../../backend/agent/skill-tools";

const agentId = z.string().min(1).max(INPUT_LIMITS.identifier);
const setLocalSkillGlobalSchema = z
  .object({ skillId: z.string().regex(/^local-skill-[\da-f-]{36}$/u), global: z.boolean() })
  .strict();
export const parseCreateLocalSkill = (input: unknown): CreateLocalSkillInput =>
  createSkillSchema.extend({ agentId }).parse(input);
export const parseReviseLocalSkill = (input: unknown): ReviseLocalSkillInput =>
  reviseSkillSchema.extend({ agentId }).parse(input);
export const parseReadLocalSkill = (input: unknown): LocalSkillRevisionInput => {
  const { skillId, revision } = readSkillSchema.parse(input);
  return revision === undefined ? { skillId } : { skillId, revision };
};
export const parseInstallLocalSkill = (input: unknown): InstallLocalSkillInput =>
  installLocalSkillSchema.extend({ agentId }).parse(input);
export const parseSetLocalSkillGlobal = (input: unknown): SetLocalSkillGlobalInput =>
  setLocalSkillGlobalSchema.parse(input);
