import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Apps conectados",
  "mobile.deviceApps.apps": "Apps",
  "mobile.deviceApps.appsFooter":
    "Deixe seus agentes usarem estes apps neste iPhone. Ao ativar um app, o iPhone pede a permissão dele. Enquanto um app estiver desativado, o OpenBot pergunta na primeira vez que um agente o usa.",
  "mobile.deviceApps.writes": "Adicionar itens",
  "mobile.deviceApps.writesFooter":
    "Até você escolher Sempre, o OpenBot pergunta antes de um agente adicionar um evento ou um lembrete.",
  "mobile.deviceApps.app.calendar": "Calendário",
  "mobile.deviceApps.app.reminders": "Lembretes",
  "mobile.deviceApps.app.contacts": "Contatos",
  "mobile.deviceApps.app.location": "Localização",
  "mobile.deviceApps.app.denied": "{app} (negado)",
  "mobile.deviceApps.write.calendar": "Adicionar eventos sem perguntar",
  "mobile.deviceApps.write.reminders": "Adicionar lembretes sem perguntar",
  "mobile.deviceApps.osDenied": "Permitir {app} nos Ajustes do iPhone",
  "mobile.deviceApps.consent.heading": "Permitir {app}?",
  "mobile.deviceApps.consent.calendarListEvents": "Um agente quer ler os eventos do seu Calendário.",
  "mobile.deviceApps.consent.calendarAddEvent": "Um agente quer adicionar este evento ao seu Calendário: {title}",
  "mobile.deviceApps.consent.remindersList": "Um agente quer ler seus Lembretes.",
  "mobile.deviceApps.consent.remindersAdd": "Um agente quer adicionar este lembrete: {title}",
  "mobile.deviceApps.consent.contactsFind": "Um agente quer buscar pessoas nos seus Contatos.",
  "mobile.deviceApps.consent.locationCurrent":
    "Um agente quer saber onde você está, com precisão de cerca de 100 metros.",
  "mobile.deviceApps.consent.privacy":
    "O que o agente lê vai para o computador dele e pode chegar ao provedor do modelo.",
  "mobile.deviceApps.consent.once": "Permitir uma vez",
  "mobile.deviceApps.consent.always": "Sempre permitir",
  "mobile.deviceApps.consent.deny": "Negar",
} as const satisfies PartialTranslation<typeof source>;
