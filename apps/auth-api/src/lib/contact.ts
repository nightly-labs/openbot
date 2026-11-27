export const CONTACT_ROUTE = "/contact";

export const CONTACT_SOCIAL_IMAGE_PATH = "/social/contact.jpg";

export const CONTACT_EMAIL = "hello@openbot.run";

export const CONTACT_TOPICS = [
  { id: "setup", label: "Custom setup" },
  { id: "partnership", label: "Partnership" },
  { id: "press", label: "Press" },
  { id: "other", label: "Something else" },
] as const;

export const CONTACT_LIMITS = {
  name: 120,
  company: 120,
  message: 2_000,
} as const;

export function contactTopicLabel(id: string): string | null {
  return CONTACT_TOPICS.find((topic) => topic.id === id)?.label ?? null;
}
