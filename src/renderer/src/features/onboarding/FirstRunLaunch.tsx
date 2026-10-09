import type { AppLogoVariant } from "@openbot/brand";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { For } from "solid-js";
import type { OnboardingAvatarVariant } from "./onboarding-avatars";

// A zigzag in the hand of the logo eyes. It fills from the left with the download, or draws and
// erases while the wait has no percent.
const SCRIBBLE_POINTS =
  "3 10 10 4 13 10 21 4 24 10 32 4 35 10 43 4 46 10 54 4 57 10 65 4 68 10 76 4 79 10 87 4 90 10 98 4 101 10 109 4";

interface FirstRunLaunchProps {
  /** The agents of the first screen. They jump while the user waits, and watch the pointer. */
  team: readonly OnboardingAvatarVariant[];
  /** The build, for the color of the scribble. */
  variant: AppLogoVariant;
  /** The free models are still downloading. Otherwise OpenBot is opening. */
  downloading: boolean;
  /** The download in percent, or null when it reports none. */
  progress: number | null;
}

/**
 * The splash while first run waits to open the app: for the free models to download and start, and
 * for the setup to save. The team from the first screen jumps in a slow wave, and the scribble under
 * it shows the progress. The app opens from here.
 */
export function FirstRunLaunch(props: FirstRunLaunchProps) {
  const { t } = useText();
  const label = () => (props.downloading ? t("onboarding.launch.downloading") : t("onboarding.opening"));
  const percent = () =>
    props.downloading && props.progress !== null ? Math.min(100, Math.max(0, props.progress)) : null;

  return (
    <div class="first-run-launch" data-variant={props.variant}>
      <div class="first-run-launch-stage">
        <div class="first-run-launch-team" aria-hidden="true">
          <For each={props.team}>
            {(member) => (
              <span class="first-run-launch-member">
                <AgentAvatar
                  seed={member.seed}
                  hue={member.hue}
                  motion="idle"
                  cycleOffset={member.cycleOffset}
                  animationOffset={member.animationOffset}
                  followPointer
                  class="first-run-launch-avatar"
                />
              </span>
            )}
          </For>
        </div>
        <div class="first-run-launch-loader">
          <div
            class="first-run-launch-progress"
            role="progressbar"
            aria-label={label()}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent() ?? undefined}
            data-known={percent() === null ? "false" : "true"}
            style={{ "--first-run-launch-percent": String((percent() ?? 0) / 100) }}
          >
            <svg class="first-run-launch-scribble" viewBox="0 0 112 14" aria-hidden="true">
              <polyline class="first-run-launch-track" points={SCRIBBLE_POINTS} pathLength="1" />
              <polyline class="first-run-launch-fill" points={SCRIBBLE_POINTS} pathLength="1" />
            </svg>
          </div>
          <p class="first-run-launch-label" role="status">
            {label()}
          </p>
        </div>
      </div>
    </div>
  );
}
