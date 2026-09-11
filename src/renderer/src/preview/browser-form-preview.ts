import type { BrowserFormField, BrowserFormState } from "@openbot/contracts/ipc";

export function browserFormPreview(): BrowserFormState {
  const field = (id: string, label: string, type: BrowserFormField["type"]): BrowserFormField => ({
    id,
    label,
    type,
    required: true,
    name: id,
    options: [],
    checked: false,
    multiple: false,
    min: "",
    max: "",
    step: "",
  });
  return {
    revision: "preview-form",
    origin: "https://accounts.example.com",
    status: "ready",
    forms: [
      {
        id: "sign-in",
        label: "Sign in",
        fields: [field("email", "Email", "email"), field("password", "Password", "password")],
        actions: [{ id: "submit", label: "Sign in" }],
      },
    ],
  };
}
