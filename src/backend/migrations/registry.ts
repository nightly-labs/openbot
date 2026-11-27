import { migration as migration0008 } from "./0008-baseline";
import { migration as migration0009 } from "./0009-refresh-provider-sessions-1";
import { migration as migration0010 } from "./0010-refresh-provider-sessions-2";
import { migration as migration0011 } from "./0011-refresh-provider-sessions-3";
import { migration as migration0012 } from "./0012-reactions-agent-actors";
import { migration as migration0013 } from "./0013-generated-agent-ids";
import { migration as migration0014 } from "./0014-refresh-provider-sessions-4";
import { migration as migration0015 } from "./0015-agent-usage";
import { migration as migration0016 } from "./0016-agent-usage-date-index";
import { migration as migration0017 } from "./0017-provider-sessions-opencode";
import { migration as migration0018 } from "./0018-channels";
import { migration as migration0019 } from "./0019-channel-settings";
import { migration as migration0020 } from "./0020-mcp-servers";
import { migration as migration0021 } from "./0021-free-computer-use-server-name";
import { migration as migration0022 } from "./0022-provider-sessions-antigravity";
import { migration as migration0023 } from "./0023-provider-sessions-custom-agents";
import { migration as migration0024 } from "./0024-provider-sessions-cursor";
import { migration as migration0025 } from "./0025-messaging";
import { migration as migration0026 } from "./0026-provider-sessions-cline";
import { migration as migration0027 } from "./0027-routine-limit-policy";
import { migration as migration0028 } from "./0028-provider-sessions-no-check";
import { migration as migration0029 } from "./0029-provider-history";
import { migration as migration0030 } from "./0030-routine-webhooks";
import { migration as migration0031 } from "./0031-routine-flows";
import { migration as migration0032 } from "./0032-agent-memory-selection";
import { migration as migration0033 } from "./0033-routine-missed-runs";
import { migration as migration0034 } from "./0034-agent-waits";
import { migration as migration0035 } from "./0035-routine-run-source";
import { migration as migration0036 } from "./0036-messaging-memory";
import { migration as migration0037 } from "./0037-routine-results";
import { migration as migration0038 } from "./0038-agent-tasks";
import { migration as migration0039 } from "./0039-repeated-mailbox-reconciliations";
import { migration as migration0040 } from "./0040-thread-message-order";
import { migration as migration0041 } from "./0041-attachment-owner-index";
import { migration as migration0042 } from "./0042-routine-flow-sweep-indexes";
import { migration as migration0043 } from "./0043-thread-event-type-index";
import { migration as migration0044 } from "./0044-messaging-allowed-roles";
import { migration as migration0045 } from "./0045-browser-profiles";
import { migration as migration0046 } from "./0046-workflows";
import { migration as migration0047 } from "./0047-agent-threads";
import { migration as migration0048 } from "./0048-agent-thread-branch";
import { migration as migration0049 } from "./0049-github-workflows";
import { migration as migration0050 } from "./0050-discord-workflows";
import { migration as migration0051 } from "./0051-messaging-allowed-senders";
import { migration as migration0052 } from "./0052-telegram-workflows";
import { migration as migration0053 } from "./0053-slack-workflows";
import { migration as migration0054 } from "./0054-agent-thread-routine";
import { migration as migration0055 } from "./0055-deleted-thread-messages";
import { migration as migration0056 } from "./0056-browser-proxies";
import { migration as migration0057 } from "./0057-agent-routine-run-place";
import { migration as migration0058 } from "./0058-agent-skill-loads";
import { migration as migration0059 } from "./0059-messaging-pings";
import { migration as migration0060 } from "./0060-agent-memory-site";
import { migration as migration0061 } from "./0061-pinned-thread-messages";
import { migration as migration0062 } from "./0062-messaging-history";
import { migration as migration0063 } from "./0063-crm";
import { migration as migration0064 } from "./0064-provider-history-compaction";
import { migration as migration0065 } from "./0065-thread-event-compaction";
import { migration as migration0066 } from "./0066-workflow-step-settings";
import { migration as migration0067 } from "./0067-thread-message-ordinal-index";
import { migration as migration0068 } from "./0068-workflow-paused";
import { migration as migration0069 } from "./0069-messaging-sender-mode";
import { migration as migration0070 } from "./0070-thread-activity-sequence-index";
import type { OpenBotMigration } from "./migration";

/** Every migration, in order. A new migration is a new file with the next version, added at the end. */
export const MIGRATIONS: readonly OpenBotMigration[] = [
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
  migration0015,
  migration0016,
  migration0017,
  migration0018,
  migration0019,
  migration0020,
  migration0021,
  migration0022,
  migration0023,
  migration0024,
  migration0025,
  migration0026,
  migration0027,
  migration0028,
  migration0029,
  migration0030,
  migration0031,
  migration0032,
  migration0033,
  migration0034,
  migration0035,
  migration0036,
  migration0037,
  migration0038,
  migration0039,
  migration0040,
  migration0041,
  migration0042,
  migration0043,
  migration0044,
  migration0045,
  migration0046,
  migration0047,
  migration0048,
  migration0049,
  migration0050,
  migration0051,
  migration0052,
  migration0053,
  migration0054,
  migration0055,
  migration0056,
  migration0057,
  migration0058,
  migration0059,
  migration0060,
  migration0061,
  migration0062,
  migration0063,
  migration0064,
  migration0065,
  migration0066,
  migration0067,
  migration0068,
  migration0069,
  migration0070,
];
