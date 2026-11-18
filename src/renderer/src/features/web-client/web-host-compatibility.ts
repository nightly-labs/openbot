import {
  decodeTeamProtocolSupportExpanded,
  TEAM_WEB_CLIENT_PROTOCOL,
  teamWebRtcClientProtocol,
} from "@openbot/contracts/team-protocol/current";
import { hasTeamProtocolV10Lists, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";

/**
 * Reads the compatibility of a host with the protocol range of the web client. The first read of a
 * connection does not know the protocol, so a host of protocol 10 answers it as protocol 9. Then the
 * peer knows the protocol, and a second read gets the protocol 10 lists with the full set.
 */
export async function readWebHostCompatibility(read: () => Promise<unknown>) {
  const first = await read();
  const support = decodeTeamProtocolSupportExpanded(first);
  const negotiated = teamWebRtcClientProtocol(support.protocol, TEAM_WEB_CLIENT_PROTOCOL);
  if (hasTeamProtocolV10Lists(first) || negotiated.update || (negotiated.protocol ?? 0) < TEAM_PROTOCOL_V10)
    return { support, negotiated };
  return { support: decodeTeamProtocolSupportExpanded(await read()), negotiated };
}
