import { describe, expect, it } from "vitest";
import { createSourceLocalizer } from "./source-matcher";

const source = {
  "error.test.plain": "The skill name is already taken.",
  "error.test.named": "Could not open {name}.",
  "error.test.wrapped": "Could not save the file: {reason}",
  "error.test.regex": "Path (a|b) is [invalid]? {name}.",
  "error.test.count": { one: "{count} file is too large.", other: "{count} files are too large." },
  "error.test.untranslated": "Only English has this one.",
} as const;

const localizer = createSourceLocalizer({
  source,
  translations: {
    en: {},
    fr: {
      "error.test.plain": "Ce nom de compétence est déjà utilisé.",
      "error.test.named": "Impossible d’ouvrir {name}.",
      "error.test.wrapped": "Impossible d’enregistrer le fichier : {reason}",
      "error.test.regex": "Le chemin (a|b) est [invalide] ? {name}.",
      "error.test.count": {
        one: "{count} fichier est trop volumineux.",
        other: "{count} fichiers sont trop volumineux.",
      },
    },
    ja: {},
  },
});

describe("createSourceLocalizer", () => {
  it("translates plain text and text with values", () => {
    expect(localizer.localize("The skill name is already taken.", "fr")).toBe("Ce nom de compétence est déjà utilisé.");
    expect(localizer.localize("Could not open notes.md.", "fr")).toBe("Impossible d’ouvrir notes.md.");
  });

  it("selects the plural form from the matched count", () => {
    expect(localizer.localize("1 file is too large.", "fr")).toBe("1 fichier est trop volumineux.");
    expect(localizer.localize("3 files are too large.", "fr")).toBe("3 fichiers sont trop volumineux.");
  });

  it("reads regular expression characters in a template as text", () => {
    expect(localizer.localize("Path (a|b) is [invalid]? x.", "fr")).toBe("Le chemin (a|b) est [invalide] ? x.");
    expect(localizer.localize("Path a is invalid x.", "fr")).toBe("Path a is invalid x.");
  });

  it("translates a nested reason", () => {
    expect(localizer.localize("Could not save the file: Could not open a.txt.", "fr")).toBe(
      "Impossible d’enregistrer le fichier : Impossible d’ouvrir a.txt.",
    );
  });

  it("returns unmatched text and untranslated keys in English", () => {
    expect(localizer.localize("Provider said no.", "fr")).toBe("Provider said no.");
    expect(localizer.localize("Only English has this one.", "fr")).toBe("Only English has this one.");
    expect(localizer.localize("Could not open notes.md.", "ja")).toBe("Could not open notes.md.");
  });

  it("finds exactly one template for each template's own text", () => {
    expect(localizer.matchingKeys("Could not open notes.md.")).toEqual(["error.test.named"]);
  });
});
