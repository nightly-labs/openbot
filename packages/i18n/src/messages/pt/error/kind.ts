import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Não foi possível conectar. Verifique sua conexão e tente novamente.",
  "error.kind.timeout": "A solicitação demorou demais. Verifique se a ação foi concluída antes de tentar novamente.",
  "error.kind.storage":
    "Não há espaço de armazenamento suficiente. Libere espaço no computador que executa o OpenBot e tente novamente.",
  "error.kind.filePermission":
    "O OpenBot não tem permissão para concluir esta ação. Verifique as permissões do arquivo ou da pasta e tente novamente.",
  "error.kind.notFound":
    "Não foi possível encontrar um arquivo ou uma pasta necessária. Restaure o item ou escolha outro e tente novamente.",
  "error.kind.readOnly": "Esta pasta é somente leitura. Escolha uma pasta em que você possa gravar e tente novamente.",
  "error.kind.conflict": "Já existe um item com este nome. Escolha outro nome e tente novamente.",
  "error.kind.auth": "A autenticação falhou. Verifique sua conta ou a conexão com o servidor e tente novamente.",
  "error.kind.permission": "Você não tem permissão para concluir esta ação. Peça acesso ao proprietário.",
  "error.kind.rateLimit": "Há solicitações demais. Aguarde um momento e tente novamente.",
  "error.kind.service": "O serviço está indisponível. Aguarde um momento e tente novamente.",
} as const satisfies PartialTranslation<typeof source>;
