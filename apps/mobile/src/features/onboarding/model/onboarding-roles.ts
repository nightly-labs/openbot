import { avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";

export interface OnboardingRole {
  id: "builder" | "researcher" | "planner" | "writer" | "helper";
  avatarSeed: string;
  avatarHue: AvatarHue;
  title: MobileTextKey;
  description: MobileTextKey;
  ideas: readonly [MobileTextKey, MobileTextKey, MobileTextKey];
}

export const ONBOARDING_ROLES: readonly OnboardingRole[] = [
  {
    id: "builder",
    avatarSeed: "onboarding:3",
    avatarHue: 245,
    title: "mobile.onboarding.role.builder",
    description: "mobile.onboarding.role.builderBody",
    ideas: ["mobile.onboarding.idea.builder1", "mobile.onboarding.idea.builder2", "mobile.onboarding.idea.builder3"],
  },
  {
    id: "researcher",
    avatarSeed: "onboarding:9",
    avatarHue: 185,
    title: "mobile.onboarding.role.researcher",
    description: "mobile.onboarding.role.researcherBody",
    ideas: [
      "mobile.onboarding.idea.researcher1",
      "mobile.onboarding.idea.researcher2",
      "mobile.onboarding.idea.researcher3",
    ],
  },
  {
    id: "planner",
    avatarSeed: "onboarding:6",
    avatarHue: 30,
    title: "mobile.onboarding.role.planner",
    description: "mobile.onboarding.role.plannerBody",
    ideas: ["mobile.onboarding.idea.planner1", "mobile.onboarding.idea.planner2", "mobile.onboarding.idea.planner3"],
  },
  {
    id: "writer",
    avatarSeed: "onboarding:25",
    avatarHue: 320,
    title: "mobile.onboarding.role.writer",
    description: "mobile.onboarding.role.writerBody",
    ideas: ["mobile.onboarding.idea.writer1", "mobile.onboarding.idea.writer2", "mobile.onboarding.idea.writer3"],
  },
  {
    id: "helper",
    avatarSeed: "onboarding:2",
    avatarHue: 150,
    title: "mobile.onboarding.role.helper",
    description: "mobile.onboarding.role.helperBody",
    ideas: ["mobile.onboarding.idea.helper1", "mobile.onboarding.idea.helper2", "mobile.onboarding.idea.helper3"],
  },
];

export const CUSTOM_CHOICE = ONBOARDING_ROLES.length;
export const CHOICE_COUNT = ONBOARDING_ROLES.length + 1;
const CUSTOM_SWATCH = "#8e8e93";
export const CHOICE_SWATCHES: readonly string[] = [
  ...ONBOARDING_ROLES.map((role) => avatarHueSwatch(role.avatarHue)),
  CUSTOM_SWATCH,
];

export const CUSTOM_AGENT_IDEAS: OnboardingRole["ideas"] = [
  "mobile.onboarding.idea.helper1",
  "mobile.onboarding.idea.helper2",
  "mobile.onboarding.idea.helper3",
];
