import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  // Agent marketplace and agent link errors.
  "error.marketplace.timezoneInvalid": "Le fuseau horaire local n’est pas valide.",
  "error.marketplace.installedAgentMissing": "L’agent installé n’existe plus.",
  "error.marketplace.differentListing": "Cet agent local a été installé à partir d’un autre agent du marketplace.",
  "error.marketplace.marketplaceAvatarInvalid": "L’avatar de l’agent du marketplace n’est pas valide.",
  "error.marketplace.shareCardInvalid": "La carte de partage n’est pas valide.",
  "error.marketplace.cannotPublish": "Cet agent ne peut pas être publié.",
  "error.marketplace.templateName": {
    one: "Donnez à cet agent un nom de 1 à {count} caractère.",
    other: "Donnez à cet agent un nom de 1 à {count} caractères.",
  },
  "error.marketplace.templateRole": {
    one: "Le rôle dépasse {count} caractère. Raccourcissez-le.",
    other: "Le rôle dépasse {count} caractères. Raccourcissez-le.",
  },
  "error.marketplace.templateNoInstructions": "Ajoutez des instructions à cet agent avant de le publier.",
  "error.marketplace.templateInstructions": {
    one: "Les instructions dépassent {count} caractère. Raccourcissez-les.",
    other: "Les instructions dépassent {count} caractères. Raccourcissez-les.",
  },
  "error.marketplace.templateAvatar":
    "L’avatar de cet agent n’est pas valide. Choisissez-le de nouveau dans les réglages de l’agent.",
  "error.marketplace.templateSkills": {
    one: "Un agent peut publier au plus {count} compétence. Retirez-en.",
    other: "Un agent peut publier au plus {count} compétences. Retirez-en.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Un agent peut publier au plus {count} compétence locale. Retirez-en.",
    other: "Un agent peut publier au plus {count} compétences locales. Retirez-en.",
  },
  "error.marketplace.templateSkill":
    "La compétence « {name} » ne peut pas être publiée. Vérifiez son nom et son fichier SKILL.md.",
  "error.marketplace.templateRoutines": {
    one: "Un agent peut publier au plus {count} routine. Retirez-en.",
    other: "Un agent peut publier au plus {count} routines. Retirez-en.",
  },
  "error.marketplace.templateRoutine": {
    one: "La routine « {name} » doit avoir un nom de {count} caractère au plus et une instruction.",
    other: "La routine « {name} » doit avoir un nom de {count} caractères au plus et une instruction.",
  },
  "error.marketplace.templateRoutineNoName": "sans nom",
  "error.marketplace.templateTooLarge":
    "Cet agent est trop volumineux pour être publié. Raccourcissez ses instructions, ses compétences ou ses routines.",
  "error.marketplace.linkInvalid": "Le lien de l’agent n’est pas valide.",
  "error.marketplace.changedSinceOpened":
    "Cet agent a changé depuis que vous l’avez ouvert. Ouvrez de nouveau le lien pour voir la nouvelle version.",
  "error.marketplace.skillNameConflict":
    "Vous avez déjà une autre compétence locale nommée « {name} ». Renommez-la ou supprimez-la, puis ajoutez de nouveau cet agent.",
  "error.marketplace.avatarInvalid": "L’avatar de l’agent n’est pas valide.",
  "error.marketplace.secretInName": "Retirez le secret ou l’adresse e-mail du nom avant la publication.",
  "error.marketplace.secretInTitle": "Retirez le secret ou l’adresse e-mail du titre avant la publication.",
  "error.marketplace.secretInInstructions":
    "Retirez le secret ou l’adresse e-mail des instructions avant la publication.",
  "error.marketplace.secretInRoutine":
    "Retirez le secret ou l’adresse e-mail de la routine « {name} » avant la publication.",
  "error.marketplace.secretInSkill":
    "Retirez le secret ou l’adresse e-mail de la compétence « {name} » avant la publication.",
} as const satisfies PartialTranslation<typeof source>;
