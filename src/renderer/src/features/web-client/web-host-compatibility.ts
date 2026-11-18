import { readTeamHostCompatibility, TEAM_WEB_CLIENT_PROTOCOL } from "@openbot/contracts/team-protocol/current";

/** Reads the compatibility of a host with the protocol range of the web client (`readTeamHostCompatibility`). */
export function readWebHostCompatibility(read: () => Promise<unknown>) {
  return readTeamHostCompatibility(read, TEAM_WEB_CLIENT_PROTOCOL);
}
