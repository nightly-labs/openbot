import { teamPort } from "./team-port";

export function notifyTeamTyping(agentId: string, typing: boolean): void {
  void teamPort()
    .servers.setTyping({ agentId: typing ? agentId : null, typing })
    .catch(() => {});
}
