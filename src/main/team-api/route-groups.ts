import { GROUP_CHATS_CAPABILITY, parseGroupCommand, parseGroupRead } from "@openbot/contracts/ipc";
import { GROUP_ROUTES, groupRequest } from "@openbot/contracts/team-protocol/groups-v1";
import type { GroupService } from "../../backend/group-service";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

export async function routeGroups(
  context: TeamApiRequestContext,
  groups: GroupService | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const list = method === "GET" && url.pathname === GROUP_ROUTES.list;
  const read = method === "POST" && url.pathname === GROUP_ROUTES.read;
  const command = method === "POST" && url.pathname === GROUP_ROUTES.command;
  if (!list && !read && !command) return "unmatched";
  if (!groups || !capabilities.has(GROUP_CHATS_CAPABILITY))
    throw new HttpError(400, "Group chats are not supported by this connection.");
  if (list) return json(200, groups.store.list(member.id));
  if (read) {
    const input = parseGroupRead(groupRequest(url.pathname, await readJson(request)));
    return json(200, groups.store.page(input.groupId, input.beforeSequence));
  }
  const input = parseGroupCommand(groupRequest(url.pathname, await readJson(request)));
  if (input.type === "archive" && member.role === "member") throw new HttpError(403, "Members cannot archive groups.");
  return json(200, await groups.command(input, { id: member.id, name: member.name ?? "Team member" }));
}
