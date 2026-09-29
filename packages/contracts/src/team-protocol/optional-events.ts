// Events that optional capabilities add outside the frozen base event vocabularies. The base event
// adapters reject them, so each transport asks here first and sends or decodes them as they are.
import { type ChannelEvent, channelEvent } from "./channels-v1";
import { type HostRestartEvent, hostRestartEvent } from "./host-update-v1";
import { type SkillsEvent, skillsEvent } from "./skills-events-v1";

export type OptionalTeamEvent = ChannelEvent | HostRestartEvent | SkillsEvent;

/** The optional event in `value`, or null for any other event. A malformed optional event throws. */
export function optionalTeamEvent(value: unknown): OptionalTeamEvent | null {
  return channelEvent(value) ?? hostRestartEvent(value) ?? skillsEvent(value);
}
