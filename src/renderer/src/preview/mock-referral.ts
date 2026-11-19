import type { ReferralDesktopApi } from "@openbot/contracts/ipc";
import {
  REFERRAL_FRIEND_STATUSES,
  REFERRAL_PAGE_SIZE,
  type ReferralFilter,
  type ReferralFriend,
  type ReferralFriendStatus,
  type ReferralState,
  referralMinimum,
} from "@openbot/contracts/referral";

const OWN_CODE = "k7m2p9qx";

const DAY = 24 * 60 * 60_000;

const FIRST_NAMES = [
  "Marta",
  "Jonas",
  "Priya",
  "Amelia",
  "Léa",
  "Tomás",
  "Kenji",
  "Oskar",
  "Fatima",
  "Daniel",
  "Sofia",
  "Mateusz",
  "Hannah",
  "Lucas",
  "Yuki",
  "Noah",
  "Elif",
  "Ava",
  "Chidi",
  "Ingrid",
] as const;

const LAST_INITIALS = ["K", "A", "R", "T", "M", "G", "W", "N", "E", "O", "B", "S", "F", "Y", "L", "P", "H"] as const;

function statusAt(index: number): ReferralFriendStatus {
  const slot = (index * 7) % 10;
  if (slot < 4) return "paying";
  if (slot < 8) return "no-plan";
  return "stopped";
}

function friendAt(index: number, now: number): ReferralFriend {
  const name = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_INITIALS[(index * 3) % LAST_INITIALS.length]}.`;
  const status = statusAt(index);
  const joinedAt = now - (index * 2 + 1) * DAY;
  const paidSince = status === "no-plan" ? null : Math.min(joinedAt + ((index % 4) + 1) * DAY, now);
  const stoppedAt =
    status === "stopped" && paidSince !== null
      ? Math.round(paidSince + ((now - paidSince) * ((index % 7) + 1)) / 9)
      : null;
  const months = paidSince === null ? 0 : (index % 5) + 1;
  const earned = status === "paying" ? months - 1 : months;
  return {
    id: `friend-${index}`,
    name,
    status,
    joinedAt,
    paidSince,
    stoppedAt,
    earned: earned > 0 ? [{ currency: "eur", amountMinor: earned * 190 }] : [],
    pending: status === "paying" && earned === 0 ? [{ currency: "eur", amountMinor: 190 }] : [],
  };
}

export function createMockReferral(friendCount = 45, now = Date.now()): ReferralDesktopApi {
  const friends = Array.from({ length: friendCount }, (_, index) => friendAt(index, now));
  const counts: Record<ReferralFilter, number> = { all: friends.length, paying: 0, "no-plan": 0, stopped: 0 };
  for (const status of REFERRAL_FRIEND_STATUSES) {
    counts[status] = friends.filter((friend) => friend.status === status).length;
  }
  return {
    getState: async (request): Promise<ReferralState> => {
      const shown = request.filter === "all" ? friends : friends.filter((friend) => friend.status === request.filter);
      const lastPage = Math.max(0, Math.ceil(shown.length / REFERRAL_PAGE_SIZE) - 1);
      const page = Math.min(request.page, lastPage);
      return {
        available: true,
        link: `https://openbot.run/?ref=${OWN_CODE}`,
        credit: [{ currency: "eur", amountMinor: 1240 }],
        earned: [{ currency: "eur", amountMinor: 8600 }],
        pending: [{ currency: "eur", amountMinor: 190 }],
        ready: [{ currency: "eur", amountMinor: 1140 }],
        minimum: [{ currency: "eur", amountMinor: referralMinimum("eur") }],
        counts: { ...counts },
        filter: request.filter,
        page,
        friends: structuredClone(shown.slice(page * REFERRAL_PAGE_SIZE, (page + 1) * REFERRAL_PAGE_SIZE)),
      };
    },
  };
}
