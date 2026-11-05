import type { SentMessageStats } from "@openbot/contracts/ipc";
import { dialogOpen, toast } from "@openbot/ui";
import { type SocialFollowStep, SocialFollowToast } from "@openbot/ui/features/social-follow/SocialFollowToast";
import type { SocialNetwork, SocialNetworkId } from "@openbot/ui/features/social-follow/social-networks";
import { currentText } from "@openbot/ui/text";
import { Option, Schema } from "effect";
import { createSignal } from "solid-js";
import { appPort } from "../../app-port";
import { writeClipboardText } from "../../clipboard";
import { githubStarPromptShownThisSession } from "./github-star-prompt";

const STORAGE_KEY = "openbot:social-follow-prompt";
const TOAST_ID = "social-follow-prompt";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The first show: after two days of use and ten messages. */
const FIRST_SHOW_DAYS = 2;
const FIRST_SHOW_MESSAGES = 10;
/** A closed toast comes back 7 days after the first show, then 30 days after the second. Then never. */
const RETRY_DAYS = [7, 30] as const;
const MAX_SHOWS = RETRY_DAYS.length + 1;
/** The database count is read at most this often while a user does not qualify yet. */
const STATS_READ_INTERVAL_MS = 10 * 60 * 1000;
/** The toast closes itself this long after the user follows. */
const FOLLOWED_CLOSE_MS = 4000;

const POST_DESTINATIONS = {
  x: "x-post",
  threads: "threads-post",
  linkedin: "linkedin-post",
  reddit: "reddit-post",
  instagram: "instagram-post",
  tiktok: "tiktok-post",
  facebook: "facebook-post",
} as const satisfies Record<SocialNetworkId, string>;

/**
 * What this device remembers. `localFirstSentAt` and `localSent` count the messages sent from this
 * device, also to a remote server, whose messages are not in the database of this computer.
 * `done` is true after a post or a follow: the toast never comes back.
 */
const SocialFollowState = Schema.Struct({
  shows: Schema.Finite,
  lastShownAt: Schema.NullOr(Schema.Finite),
  done: Schema.Boolean,
  localFirstSentAt: Schema.NullOr(Schema.Finite),
  localSent: Schema.Finite,
});
type SocialFollowState = Schema.Schema.Type<typeof SocialFollowState>;
const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(SocialFollowState));

const EMPTY_STATE: SocialFollowState = {
  shows: 0,
  lastShownAt: null,
  done: false,
  localFirstSentAt: null,
  localSent: 0,
};

/** Throws when the browser blocks storage. A damaged value reads as empty. */
function readState(): SocialFollowState {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === null ? EMPTY_STATE : Option.getOrElse(decodeState(saved), () => EMPTY_STATE);
}

/** Returns false when the browser blocks storage. */
function writeState(state: SocialFollowState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function updateState(change: (state: SocialFollowState) => SocialFollowState): SocialFollowState | null {
  try {
    const state = change(readState());
    return writeState(state) ? state : null;
  } catch {
    return null;
  }
}

/** True when the schedule allows a show now, before the usage check of the first show. */
function retryDue(state: SocialFollowState, now: number): boolean {
  if (state.done || state.shows >= MAX_SHOWS) return false;
  if (state.shows === 0) return true;
  const days = RETRY_DAYS[state.shows - 1];
  return days !== undefined && state.lastShownAt !== null && now - state.lastShownAt >= days * DAY_MS;
}

function usedEnough(state: SocialFollowState, stats: SentMessageStats | null, now: number): boolean {
  const databaseFirst = stats?.firstSentAt ? Date.parse(stats.firstSentAt) : Number.NaN;
  const firsts = [state.localFirstSentAt, Number.isFinite(databaseFirst) ? databaseFirst : null].filter(
    (value): value is number => value !== null,
  );
  if (firsts.length === 0) return false;
  const sent = Math.max(state.localSent, stats?.sentCount ?? 0);
  return now - Math.min(...firsts) >= FIRST_SHOW_DAYS * DAY_MS && sent >= FIRST_SHOW_MESSAGES;
}

let sentThisSession = false;
let checking = false;
let lastStatsReadAt = 0;

// A chat window counts its messages in the same storage, and only the main window shows the toast.
// The event comes only from other windows.
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) sentThisSession = true;
});

/** The toast must not cover a dialog, or follow the GitHub star toast in the same session. */
function blocked(): boolean {
  return githubStarPromptShownThisSession() || dialogOpen();
}

/** Count one message that the user sent to an agent from this device. Blocked storage counts nothing. */
export function noteSocialFollowMessageSent(): void {
  const now = Date.now();
  const state = updateState((saved) => ({
    ...saved,
    localFirstSentAt: saved.localFirstSentAt ?? now,
    localSent: saved.localSent + 1,
  }));
  if (state) sentThisSession = true;
}

/**
 * An agent finished a reply. When the user sent a message in this session and the schedule allows
 * it, the toast asks for a post. It does not show in a session that showed the GitHub star toast, or
 * over an open dialog.
 */
export function noteSocialFollowReplyCompleted(): void {
  if (!sentThisSession || checking || blocked()) return;
  let state: SocialFollowState;
  try {
    state = readState();
  } catch {
    return;
  }
  const now = Date.now();
  if (!retryDue(state, now)) return;
  if (state.shows > 0) {
    showToast();
    return;
  }
  if (usedEnough(state, null, now)) {
    showToast();
    return;
  }
  if (now - lastStatsReadAt < STATS_READ_INTERVAL_MS) return;
  lastStatsReadAt = now;
  checking = true;
  appPort()
    .getSentMessageStats()
    .then((stats) => {
      // A dialog can open while the database reads.
      if (usedEnough(state, stats, Date.now()) && !blocked()) showToast();
    })
    .catch(() => undefined)
    .finally(() => {
      checking = false;
    });
}

/** Copies the first post for a network that takes no text in its post link. */
function copyDraftPost(): Promise<"copied" | "opened"> {
  return writeClipboardText(currentText().t("app.socialFollow.draftPost", { site: "openbot.run" })).then(
    () => "copied",
    () => "opened",
  );
}

/**
 * Closes the toast after the window was visible for `FOLLOWED_CLOSE_MS`. The follow page opens over
 * the window, and a hidden window does not count: the user reads the thanks when they come back.
 */
function closeAfterSeen(close: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = () => {
    document.removeEventListener("visibilitychange", restart);
    close();
  };
  function restart() {
    clearTimeout(timer);
    timer = document.visibilityState === "visible" ? setTimeout(done, FOLLOWED_CLOSE_MS) : undefined;
  }
  document.addEventListener("visibilitychange", restart);
  restart();
}

function showToast(): void {
  // The show counts before the toast: storage that refuses the write shows nothing.
  const saved = updateState((state) => ({ ...state, shows: state.shows + 1, lastShownAt: Date.now() }));
  if (!saved) return;

  // Sonner renders the content more than once, so the step lives here and not in the toast.
  const [step, setStep] = createSignal<SocialFollowStep>({ kind: "ask" });
  const finish = () => updateState((state) => ({ ...state, done: true }));
  const close = () => toast.dismiss(TOAST_ID);
  // One post page for each network, and one follow page. The copy of a post takes time, and a
  // second click can come before it ends.
  const posted = new Set<SocialNetworkId>();
  let copying = false;
  let following = false;

  const post = async (network: SocialNetwork) => {
    if (copying || posted.has(network.id)) return;
    posted.add(network.id);
    finish();
    copying = network.compose === "copy";
    // The copy comes before the page opens: it needs the focus of this window.
    const result = network.compose === "copy" ? await copyDraftPost() : network.compose;
    copying = false;
    setStep({ kind: "posted", network, result });
    void appPort().openExternal(POST_DESTINATIONS[network.id]);
  };
  const follow = (network: SocialNetwork) => {
    if (following) return;
    following = true;
    finish();
    setStep({ kind: "followed", network });
    void appPort().openExternal(network.id);
    closeAfterSeen(close);
  };

  toast(
    () => (
      <SocialFollowToast step={step()} onPost={(network) => void post(network)} onFollow={follow} onClose={close} />
    ),
    {
      id: TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
      closeButton: false,
      class: "social-follow-toast-host",
    },
  );
}
