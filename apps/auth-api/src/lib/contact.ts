// The contact form on `/contact` and the `/v1/contact` route that sends it share these values.

/** The path of the contact page. */
export const CONTACT_ROUTE = "/contact";

/** The social image of the contact page. Its alt text is the `sitePage.contact.imageAlt` key. */
export const CONTACT_SOCIAL_IMAGE_PATH = "/social/contact.jpg";

/** The mailbox that receives each message. The form also names it for people who prefer email. */
export const CONTACT_EMAIL = "hello@openbot.run";

/** The topics of the form. The labels name the topic in the email to the team; the form shows `sitePage.contact.topic.*`. */
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
