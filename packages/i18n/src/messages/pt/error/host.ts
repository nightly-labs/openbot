import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "O Remote Signal não forneceu servidores ICE.",
  "error.host.webRtcNotConfigured": "O serviço WebRTC do computador anfitrião não está configurado.",
  "error.host.runtimeNotInstalled": "O ambiente de execução da área de trabalho remota não está instalado.",
  "error.host.setupUnavailable": "A configuração de permissões não está disponível.",
  "error.host.accountChangedDuringUpdate": "A conta conectada mudou durante a atualização deste servidor.",
  "error.host.nameBeforePublish": "Dê um nome a este OpenBot antes de publicá-lo.",
  "error.host.memberNotFound": "O membro remoto não existe.",
  "error.host.publishBeforeInvite": "Torne este OpenBot público antes de criar um convite.",
  "error.host.teamAccessUnavailable": "Seu acesso à equipe está indisponível.",
  "error.host.ownerIdentityUnavailable": "A identidade do proprietário do computador anfitrião está indisponível.",
  "error.host.reserveAddressFailed": "Não foi possível reservar o endereço público.",
  "error.host.publishFailed": "Não foi possível publicar este OpenBot.",
  "error.host.mobileConnectPublishFailed": "Não foi possível publicar este OpenBot para Conectar celular.",
  "error.host.mobileConnectHostChanged": "O computador anfitrião de Conectar celular mudou. Tente novamente.",
  "error.host.noServer": "Este computador não tem um servidor para alterar.",
  "error.host.identityLocalOnly": "O nome e o logotipo do servidor só podem ser alterados no computador que o executa.",
  "error.host.maintenanceInterrupted":
    "A manutenção do computador anfitrião foi interrompida. Verifique o aplicativo e redefina o estado do computador anfitrião antes de tentar novamente.",
  "error.host.updateFailed":
    "A atualização do computador anfitrião falhou durante {phase}. Verifique a propriedade do pacote, a assinatura, o status dos ambientes de usuário e o espaço livre em disco antes de redefinir o estado.",
  "error.host.tenantsNotIdle":
    "Os ambientes de usuário não permaneceram ociosos por cinco minutos dentro de duas horas.",
  "error.host.tenantShutdownTimeout":
    "O tempo para encerrar o ambiente de usuário esgotou. Nenhuma substituição do aplicativo foi iniciada.",
  "error.host.tenantHealthMissing":
    "Os relatórios de integridade dos ambientes de usuário estão ausentes ou indicam falhas após a reinicialização. Verifique as sessões dos ambientes de usuário antes de outra atualização.",
} as const satisfies PartialTranslation<typeof source>;
