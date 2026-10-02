import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Site",
  "plugin.link.privacyPolicy": "Política de privacidade",
  "plugin.link.terms": "Termos de serviço",
  "plugin.copyLink": "Copiar link",
  "plugin.askPrompt": "Pergunte a {name}: {prompt}",
  "plugin.section.apps": "Aplicativos",
  "plugin.section.skills": "Habilidades",
  "plugin.section.information": "Informações",
  "plugin.info.developer": "Desenvolvedor",
  "plugin.info.category": "Categoria",
  "plugin.info.version": "Versão",
  "plugin.uninstallDialog.title": "Desconectar {name}?",
  "plugin.uninstallDialog.description":
    "Isso remove o que {name} instalou neste computador. Nada mais neste computador anfitrião ou neste agente muda.",
  "plugin.uninstallDialog.confirm": "Desconectar",
  "plugin.uninstallDialog.appsLabel": "Aplicativos para remover, {number}",
  "plugin.uninstallDialog.appsTitle": "Aplicativos removidos deste computador anfitrião",
  "plugin.uninstallDialog.appsNote":
    "As ferramentas deixam de estar disponíveis e qualquer acesso à conta que o OpenBot mantinha para eles é esquecido.",
  "plugin.uninstallDialog.skillsLabel": "Habilidades para remover, {number}",
  "plugin.uninstallDialog.skillsTitle": "Habilidades removidas de {agentName}",
} as const satisfies PartialTranslation<typeof source>;
