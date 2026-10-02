import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "O fuso horário local é inválido.",
  "error.marketplace.installedAgentMissing": "O agente instalado não existe mais.",
  "error.marketplace.differentListing": "Este agente local foi instalado a partir de outro agente da loja.",
  "error.marketplace.marketplaceAvatarInvalid": "O avatar do agente da loja é inválido.",
  "error.marketplace.shareCardInvalid": "O cartão de compartilhamento é inválido.",
  "error.marketplace.cannotPublish": "Este agente não pode ser publicado.",
  "error.marketplace.templateName": {
    one: "Dê a este agente um nome de 1 a {count} caractere.",
    other: "Dê a este agente um nome de 1 a {count} caracteres.",
  },
  "error.marketplace.templateRole": {
    one: "A função tem mais de {count} caractere. Encurte o texto.",
    other: "A função tem mais de {count} caracteres. Encurte o texto.",
  },
  "error.marketplace.templateNoInstructions": "Adicione instruções a este agente antes de publicá-lo.",
  "error.marketplace.templateInstructions": {
    one: "As instruções têm mais de {count} caractere. Encurte o texto.",
    other: "As instruções têm mais de {count} caracteres. Encurte o texto.",
  },
  "error.marketplace.templateAvatar":
    "O avatar deste agente é inválido. Escolha-o novamente nas configurações do agente.",
  "error.marketplace.templateSkills": {
    one: "Um agente pode publicar até {count} habilidade. Remova algumas.",
    other: "Um agente pode publicar até {count} habilidades. Remova algumas.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Um agente pode publicar até {count} habilidade local. Remova algumas.",
    other: "Um agente pode publicar até {count} habilidades locais. Remova algumas.",
  },
  "error.marketplace.templateSkill":
    'A habilidade "{name}" não pode ser publicada. Verifique o nome e o arquivo SKILL.md.',
  "error.marketplace.templateRoutines": {
    one: "Um agente pode publicar até {count} rotina. Remova algumas.",
    other: "Um agente pode publicar até {count} rotinas. Remova algumas.",
  },
  "error.marketplace.templateRoutine": {
    one: 'A rotina "{name}" precisa de um nome de até {count} caractere e uma instrução.',
    other: 'A rotina "{name}" precisa de um nome de até {count} caracteres e uma instrução.',
  },
  "error.marketplace.templateRoutineNoName": "sem nome",
  "error.marketplace.templateTooLarge":
    "Este agente é grande demais para publicar. Encurte suas instruções, habilidades ou rotinas.",
  "error.marketplace.linkInvalid": "O link do agente é inválido.",
  "error.marketplace.changedSinceOpened":
    "Este agente mudou depois de você abri-lo. Abra o link novamente para revisar a nova versão.",
  "error.marketplace.skillNameConflict":
    'Você já tem outra habilidade local chamada "{name}". Renomeie ou remova essa habilidade e adicione este agente novamente.',
  "error.marketplace.avatarInvalid": "O avatar do agente é inválido.",
  "error.marketplace.secretInName": "Remova o segredo ou endereço de e-mail do nome antes de publicar.",
  "error.marketplace.secretInTitle": "Remova o segredo ou endereço de e-mail do título antes de publicar.",
  "error.marketplace.secretInInstructions": "Remova o segredo ou endereço de e-mail das instruções antes de publicar.",
  "error.marketplace.secretInRoutine": 'Remova o segredo ou endereço de e-mail da rotina "{name}" antes de publicar.',
  "error.marketplace.secretInSkill": 'Remova o segredo ou endereço de e-mail da habilidade "{name}" antes de publicar.',
  "error.marketplace.catalogLoadFailed": "Não foi possível carregar a loja. Tente novamente.",
  "error.marketplace.templateUnreadable":
    "Não foi possível ler este agente compartilhado. O proprietário pode tê-lo removido.",
} as const satisfies PartialTranslation<typeof source>;
