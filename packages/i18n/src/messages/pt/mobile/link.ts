import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "O OpenBot não conseguiu conectar. Tente novamente.",
  "mobile.link.invite.signInTitle": "Entre na sua conta para participar deste servidor",
  "mobile.link.invite.signInDescription":
    "Leia o código QR no OpenBot do seu computador. Depois, você poderá analisar o convite.",
  "mobile.link.invite.cancel": "Cancelar convite",
  "mobile.link.pairing.title": "Conectar este celular",
  "mobile.link.pairing.alreadySignedIn":
    "Você já está conectado à sua conta. Saia em Configurações antes de conectar outra conta.",
  "mobile.link.pairing.description":
    "Continue somente se você solicitou este link em Conectar celular no aplicativo para computador.",
  "mobile.link.pairing.connect": "Conectar",
  "mobile.link.plugin.title": "Abrir página do plugin",
  "mobile.link.plugin.description": "Veja este plugin no site do OpenBot.",
  "mobile.link.plugin.openFailed": "Não foi possível abrir a página do plugin.",
  "mobile.link.plugin.view": "Ver plugin",
  "mobile.link.unavailable.title": "Link indisponível",
  "mobile.link.unavailable.description":
    "Este link é inválido, não está mais disponível ou não é compatível com o aplicativo para celular.",
  "mobile.link.template.signInTitle": "Entre na sua conta para adicionar este agente",
  "mobile.link.template.signInDescription":
    "Leia o código QR no OpenBot do seu computador. Depois, você poderá analisar o agente antes de adicioná-lo.",
  "mobile.link.template.loading": "Carregando agente…",
  "mobile.link.template.creator": "Por {name}",
  "mobile.link.template.section.instructions": "Instruções",
  "mobile.link.template.section.skills": "Habilidades",
  "mobile.link.template.section.noSkills": "Nenhuma habilidade.",
  "mobile.link.template.section.routines": "Rotinas",
  "mobile.link.template.section.noRoutines": "Nenhuma rotina.",
  "mobile.link.template.skill.local": "Habilidade local (somente SKILL.md)",
  "mobile.link.template.skill.marketplace": "Habilidade da Loja, versão {version}",
  "mobile.link.template.server.title": "Adicionar ao servidor",
  "mobile.link.template.server.footer":
    "A lista mostra apenas os servidores dos quais você é proprietário ou administrador.",
  "mobile.link.template.server.updateRequired":
    "Atualize o OpenBot neste servidor para adicionar agentes compartilhados.",
  "mobile.link.template.server.none":
    "Você precisa ser proprietário ou administrador de um servidor para adicionar um agente compartilhado.",
  "mobile.link.template.install.action": "Adicionar agente",
  "mobile.link.template.install.pending": "Adicionando…",
  "mobile.link.template.install.failed": "Não foi possível adicionar o agente.",
  "mobile.link.template.notFound.title": "Agente não encontrado",
  "mobile.link.template.notFound.description":
    "Este agente compartilhado não existe ou seu criador removeu a publicação.",
  "mobile.link.template.error.title": "Não foi possível carregar o agente",
  "mobile.link.template.error.loadFailed": "Não foi possível ler o agente compartilhado. Tente novamente.",
  "mobile.link.template.error.unsupported":
    "Este servidor não pode adicionar agentes compartilhados. Atualize o OpenBot no computador que executa o servidor.",
} as const satisfies PartialTranslation<typeof source>;
