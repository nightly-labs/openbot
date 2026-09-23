import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CreateLocalSkillInput,
  InstallLocalSkillInput,
  LocalSkillRevisionInput,
  ReviseLocalSkillInput,
} from "@openbot/contracts/ipc";
import { z } from "zod";
import {
  createSkillSchema,
  installLocalSkillSchema,
  readSkillSchema,
  reviseSkillSchema,
} from "../../backend/agent/skill-tools";

const agentId = z.string().min(1).max(INPUT_LIMITS.identifier);
export const parseCreateLocalSkill = (input: unknown): CreateLocalSkillInput =>
  createSkillSchema.extend({ agentId }).parse(input);
export const parseReviseLocalSkill = (input: unknown): ReviseLocalSkillInput =>
  reviseSkillSchema.extend({ agentId }).parse(input);
export const parseReadLocalSkill = (input: unknown): LocalSkillRevisionInput => readSkillSchema.parse(input);
export const parseInstallLocalSkill = (input: unknown): InstallLocalSkillInput =>
  installLocalSkillSchema.extend({ agentId }).parse(input);
