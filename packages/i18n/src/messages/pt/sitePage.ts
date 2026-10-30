import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Não foi possível carregar esta página",
  "sitePage.error.body":
    "Verifique sua conexão e recarregue a página. Se ela ainda não carregar, volte para a página inicial.",
  "sitePage.error.reload": "Recarregar página",
  "sitePage.error.home": "Voltar ao início",
  "sitePage.join.title": "Entrar em um servidor do OpenBot",
  "sitePage.join.description": "Abra um convite privado para um servidor no OpenBot.",
  "sitePage.join.eyebrow": "Convite privado",
  "sitePage.join.intro":
    "Abra este convite no OpenBot. O app verifica o servidor e pede sua confirmação antes de se conectar.",
  "sitePage.join.invalid":
    "Este link de convite não é válido ou está incompleto. Peça um novo convite ao proprietário do servidor.",
  "sitePage.join.open": "Abrir OpenBot",
  "sitePage.join.browser": "Abrir no navegador",
  "sitePage.join.download": "Baixar OpenBot",
  "sitePage.join.notOpened":
    "Se o OpenBot não abriu, instale-o com {download} ou inicie o OpenBot uma vez para que ele possa abrir links de convite. Você também pode usar {browser}.",
  "sitePage.join.mobile":
    "Se o OpenBot estiver instalado, toque em {open}. Você também pode colar este link em Adicionar servidor no app.",
  "sitePage.join.singleUse":
    "Um link de uso único funciona uma vez e depois expira. Um link permanente funciona até o proprietário revogá-lo. O OpenBot mostra a validade antes de você entrar.",
  "sitePage.join.email": "Se o convite chegou por e-mail, entre no OpenBot com esse endereço de e-mail.",
  "sitePage.join.share": "Este link dá acesso a um servidor. Compartilhe-o apenas com pessoas que você quer convidar.",
  "sitePage.connect.title": "Voltar ao OpenBot",
  "sitePage.connect.failedTitle": "A conexão não foi concluída",
  "sitePage.connect.openApp": "Abrir OpenBot",
  "sitePage.connect.tryAgainApp": "Tentar no OpenBot",
  "sitePage.connect.tryAgainBrowser": "Tentar no navegador",
  "sitePage.connect.doneInWebClient": "Sua aba do OpenBot conclui a conexão com {name}. Você pode fechar esta aba.",
  "sitePage.connect.doneInApp": "O OpenBot conclui a conexão com {name} no seu computador.",
  "sitePage.connect.failure.cancelled": "A conexão com {name} foi cancelada. Nada mudou.",
  "sitePage.connect.failure.expired": "O login no {name} expirou. Inicie a conexão novamente.",
  "sitePage.connect.failure.exchange": "O {name} não confirmou a conexão. Tente novamente.",
  "sitePage.connect.failure.enterprise": "Conecte um workspace do Slack, não uma organização inteira.",
  "sitePage.connect.failure.takenSlack":
    "Outro servidor do OpenBot já responde neste workspace do Slack. Desconecte-o nesse servidor e tente novamente.",
  "sitePage.connect.failure.takenDiscord":
    "Outro servidor do OpenBot já responde neste servidor do Discord. Desconecte-o nesse servidor e tente novamente.",
  "sitePage.connect.failure.unavailable":
    "O OpenBot não consegue se conectar ao {name} agora. Tente novamente mais tarde.",
  "sitePage.connect.failure.tabClosed":
    "A aba do OpenBot que iniciou a conexão com {name} não respondeu. Abra o OpenBot no navegador e conecte o {name} novamente.",
  "sitePage.connect.failure.failed": "O {name} não concluiu a conexão. Tente novamente.",
  "sitePage.connect.restartHint":
    "No OpenBot, abra {marketplace}, depois {apps}, depois {name}, e selecione {connect}.",
  "sitePage.connect.notOpened":
    "Inicie o OpenBot e tente novamente. Se o OpenBot não estiver neste computador, baixe-o e conecte o {name} pelo app.",
  "sitePage.openApp.title": "Nada abriu?",
  "sitePage.openApp.dismiss": "Agora não",
  "sitePage.billing.pageTitle": "Cobrança do OpenBot",
  "sitePage.billing.updatedTitle": "Cobrança atualizada",
  "sitePage.billing.updatedBody": "Volte ao OpenBot. Você pode fechar esta página.",
  "sitePage.billing.cancelledTitle": "Pagamento cancelado",
  "sitePage.billing.cancelledBody": "Nada foi cobrado. Volte ao OpenBot.",
  "sitePage.report.pageTitle": "Denunciar um site hospedado — OpenBot",
  "sitePage.report.title": "Denunciar um site hospedado",
  "sitePage.report.intro": "Envie uma denúncia sobre conteúdo prejudicial ou ilegal em um endereço openbot.site.",
  "sitePage.report.hostnameLabel": "Endereço do site",
  "sitePage.report.hostnameMissing": "Digite o endereço do site",
  "sitePage.report.reasonLabel": "Motivo",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Malware",
  "sitePage.report.reason.abuse": "Abuso",
  "sitePage.report.reason.copyright": "Direitos autorais",
  "sitePage.report.reason.other": "Outros",
  "sitePage.report.detailsLabel": "Detalhes",
  "sitePage.report.optional": "Opcional",
  "sitePage.report.detailsPlaceholder": "Qual é o problema com este site?",
  "sitePage.report.send": "Enviar denúncia",
  "sitePage.report.sending": "Enviando…",
  "sitePage.report.tooMany": "Muitas denúncias. Tente novamente mais tarde.",
  "sitePage.report.sendFailed": "Não foi possível enviar a denúncia. Tente novamente.",
  "sitePage.report.writeTo": "Você também pode escrever para {email}.",
  "sitePage.report.sentTitle": "Denúncia enviada",
  "sitePage.report.sentBody": "Obrigado. Recebemos sua denúncia.",
  "sitePage.report.home": "Ir para a página inicial",
  "sitePage.pricing.title": "Preços do OpenBot",
  "sitePage.pricing.description":
    "Servidores hospedados e uma licença para equipes. O OpenBot é gratuito para uso pessoal no seu próprio computador.",
  "sitePage.pricing.heading": "Preços",
  "sitePage.pricing.enterprise.title": "Empresarial",
  "sitePage.pricing.enterprise.body":
    "Servidores maiores, mais de {count} membros ou o que mais você precisar. Com suporte empresarial.",
  "sitePage.pricing.enterprise.contact": "Fale com vendas",
} as const satisfies PartialTranslation<typeof source>;
