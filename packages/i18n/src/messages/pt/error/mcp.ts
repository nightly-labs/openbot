import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Este endereço não pode ser acessado pelo nome.",
  "error.mcp.redirectNotSignIn": "Este endereço não faz parte de um login.",
  "error.mcp.redirectRefused": "O login foi recusado. Volte ao OpenBot e tente novamente.",
  "error.mcp.redirectNoSignIn": "Nenhum login está aguardando isto. Ele pode ter terminado.",
  "error.mcp.redirectSignedIn": "O OpenBot está conectado. Você pode fechar esta janela.",
  "error.mcp.signInFileUnreadable": "O arquivo de login MCP não pode ser lido.",
  "error.mcp.signInFileTooLarge": "O arquivo de login MCP é muito grande.",
  "error.mcp.unsupported": "Este servidor não oferece suporte a servidores MCP.",
  "error.mcp.signInOnHost": "O login em um servidor MCP só funciona no OpenBot do computador anfitrião.",
  "error.mcp.signInAppUnsupported":
    "Este servidor não é compatível com apps de login. Atualize o OpenBot no computador anfitrião.",
  "error.mcp.redirectRelayed": "O OpenBot enviou o login para o servidor. Você pode fechar esta janela.",
  "error.mcp.relayEnded": "Este login terminou. Inicie-o novamente.",
  "error.mcp.relayNoState":
    "A página de login do servidor não protege o endereço de retorno, então o OpenBot não a abre neste computador.",
  "error.mcp.relayAddressInvalid": "Este não é o endereço do fim deste login. Copie o endereço completo do navegador.",
} as const satisfies PartialTranslation<typeof source>;
