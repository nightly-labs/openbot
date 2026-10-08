import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "La zona horaria local no es válida.",
  "error.marketplace.installedAgentMissing": "El agente instalado ya no existe.",
  "error.marketplace.differentListing": "Este agente local se instaló desde otro agente de Marketplace.",
  "error.marketplace.marketplaceAvatarInvalid": "El avatar del agente de Marketplace no es válido.",
  "error.marketplace.shareCardInvalid": "La tarjeta para compartir no es válida.",
  "error.marketplace.cannotPublish": "Este agente no se puede publicar.",
  "error.marketplace.templateName": {
    one: "Dale a este agente un nombre de 1 a {count} carácter.",
    other: "Dale a este agente un nombre de 1 a {count} caracteres.",
  },
  "error.marketplace.templateRole": {
    one: "El rol supera {count} carácter. Acórtalo.",
    other: "El rol supera los {count} caracteres. Acórtalo.",
  },
  "error.marketplace.templateNoInstructions": "Añade instrucciones a este agente antes de publicarlo.",
  "error.marketplace.templateInstructions": {
    one: "Las instrucciones superan {count} carácter. Acórtalas.",
    other: "Las instrucciones superan los {count} caracteres. Acórtalas.",
  },
  "error.marketplace.templateAvatar":
    "El avatar de este agente no es válido. Selecciónalo de nuevo en los ajustes del agente.",
  "error.marketplace.templateSkills": {
    one: "Un agente puede publicar hasta {count} habilidad. Elimina algunas.",
    other: "Un agente puede publicar hasta {count} habilidades. Elimina algunas.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Un agente puede publicar hasta {count} habilidad local. Elimina algunas.",
    other: "Un agente puede publicar hasta {count} habilidades locales. Elimina algunas.",
  },
  "error.marketplace.templateSkill": "La habilidad «{name}» no se puede publicar. Comprueba su nombre y su SKILL.md.",
  "error.marketplace.templateRoutines": {
    one: "Un agente puede publicar hasta {count} rutina. Elimina algunas.",
    other: "Un agente puede publicar hasta {count} rutinas. Elimina algunas.",
  },
  "error.marketplace.templateRoutine": {
    one: "La rutina «{name}» necesita un nombre de hasta {count} carácter y una instrucción.",
    other: "La rutina «{name}» necesita un nombre de hasta {count} caracteres y una instrucción.",
  },
  "error.marketplace.templateRoutineNoName": "sin nombre",
  "error.marketplace.templateTooLarge":
    "Este agente es demasiado grande para publicarlo. Acorta sus instrucciones, habilidades o rutinas.",
  "error.marketplace.linkInvalid": "El enlace del agente no es válido.",
  "error.marketplace.changedSinceOpened":
    "Este agente cambió después de abrirlo. Abre el enlace de nuevo para revisar la nueva versión.",
  "error.marketplace.skillNameConflict":
    "Ya tienes otra habilidad local llamada «{name}». Cámbiale el nombre o elimínala y vuelve a añadir este agente.",
  "error.marketplace.avatarInvalid": "El avatar del agente no es válido.",
  "error.marketplace.secretInName": "Elimina el secreto o la dirección de correo del nombre antes de publicar.",
  "error.marketplace.secretInTitle": "Elimina el secreto o la dirección de correo del título antes de publicar.",
  "error.marketplace.secretInInstructions":
    "Elimina el secreto o la dirección de correo de las instrucciones antes de publicar.",
  "error.marketplace.secretInRoutine":
    "Elimina el secreto o la dirección de correo de la rutina «{name}» antes de publicar.",
  "error.marketplace.secretInSkill":
    "Elimina el secreto o la dirección de correo de la habilidad «{name}» antes de publicar.",
  "error.marketplace.catalogLoadFailed": "No se pudo cargar Marketplace. Inténtalo de nuevo.",
  "error.marketplace.templateUnreadable":
    "No se pudo leer este agente compartido. Es posible que su propietario lo haya eliminado.",
} as const satisfies PartialTranslation<typeof source>;
