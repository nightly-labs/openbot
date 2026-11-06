import { Button, Heart, IconButton, PlushMascot, type PlushMascotFace, X } from "@openbot/ui";
import { createSignal, createUniqueId, For, Match, Show, Switch } from "solid-js";
import { currentText } from "../../text";
import { SocialNetworkMark } from "./social-marks";
import { SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, type SocialNetwork } from "./social-networks";

/**
 * What the toast shows. `posted` follows a network button: `result` says what the post page got.
 * `followed` follows the follow button.
 */
export type SocialFollowStep =
  | { kind: "ask" }
  | { kind: "posted"; network: SocialNetwork; result: "text" | "link" | "copied" | "opened" }
  | { kind: "followed"; network: SocialNetwork };

interface SocialFollowToastProps {
  step: SocialFollowStep;
  onPost: (network: SocialNetwork) => void;
  onFollow: (network: SocialNetwork) => void;
  onClose: () => void;
}

/**
 * The request for a post about OpenBot, then for a follow on the same network. Raise it unstyled,
 * with sonner's own timer and close button off (`duration: Infinity`), in the
 * `social-follow-toast-host` class. The caller holds the step: sonner renders the content more than
 * once, and each copy would get its own.
 */
export function SocialFollowToast(props: SocialFollowToastProps) {
  // The app's Toaster renders outside the text provider, so `useText()` would always give English.
  const { t } = currentText();
  const titleId = `social-follow-toast-${createUniqueId()}`;
  // Only the look of the plush while the pointer is on a network button.
  const [peeking, setPeeking] = createSignal(false);

  const face = (): PlushMascotFace => {
    if (props.step.kind !== "ask") return "happy";
    return peeking() ? "wide" : "wink";
  };

  const postLabel = (network: SocialNetwork) => {
    if (network.compose === "copy") return t("app.socialFollow.postCopy", { name: network.name });
    if (network.kind === "community") return t("app.socialFollow.postCommunity", { name: network.handle });
    return t("app.socialFollow.post", { name: network.name });
  };

  const postedLabel = (network: SocialNetwork, result: "text" | "link" | "copied" | "opened") => {
    if (result === "copied") return t("app.socialFollow.copied", { name: network.name });
    if (result === "link") return t("app.socialFollow.openedLink", { name: network.name });
    if (result === "text") return t("app.socialFollow.openedText", { name: network.name });
    return t("app.socialFollow.opened", { name: network.name });
  };

  const followLabel = (network: SocialNetwork) => {
    if (network.kind === "community") return t("app.socialFollow.join", { handle: network.handle });
    if (network.handle.startsWith("@")) return t("app.socialFollow.follow", { handle: network.handle });
    return t("app.socialFollow.followOn", { name: network.name });
  };

  /** The post buttons. They stay after a post, for a post on one more network. */
  const networkList = () => (
    <ul class="social-follow-networks" aria-label={t("app.socialFollow.networks")}>
      <For each={SOCIAL_NETWORK_IDS}>
        {(id) => (
          <li>
            <IconButton
              class="social-follow-network"
              variant="ghost"
              label={postLabel(SOCIAL_NETWORKS[id])}
              onPointerEnter={() => setPeeking(true)}
              onPointerLeave={() => setPeeking(false)}
              onFocus={() => setPeeking(true)}
              onBlur={() => setPeeking(false)}
              onClick={() => props.onPost(SOCIAL_NETWORKS[id])}
            >
              <SocialNetworkMark network={id} class="social-follow-mark" />
            </IconButton>
          </li>
        )}
      </For>
    </ul>
  );

  const posted = () => (props.step.kind === "posted" ? props.step : null);
  const followed = () => (props.step.kind === "followed" ? props.step : null);

  return (
    <section class="social-follow-toast" aria-labelledby={titleId}>
      <div class="social-follow-toast-plush" data-face={face()}>
        <span class="social-follow-plush">
          <PlushMascot face={face()} />
        </span>
        <Show when={props.step.kind !== "ask"}>
          <span class="social-follow-hearts">
            <For each={[0, 1, 2]}>
              {(index) => <Heart class="social-follow-heart" data-index={index} aria-hidden="true" />}
            </For>
          </span>
        </Show>
      </div>

      <div class="social-follow-toast-main">
        <Switch>
          <Match when={posted()}>
            {(step) => (
              <>
                <div class="social-follow-toast-copy" data-thanks="">
                  <strong id={titleId}>{t("app.socialFollow.thanksTitle")}</strong>
                  <p role="status">{postedLabel(step().network, step().result)}</p>
                </div>
                <div class="social-follow-toast-follow">
                  <Button type="button" variant="outline" size="sm" onClick={() => props.onFollow(step().network)}>
                    <SocialNetworkMark network={step().network.id} class="social-follow-mark" />
                    {followLabel(step().network)}
                  </Button>
                </div>
                {networkList()}
              </>
            )}
          </Match>
          <Match when={followed()}>
            {(step) => (
              <div class="social-follow-toast-copy" data-thanks="">
                <strong id={titleId}>{t("app.socialFollow.followedTitle", { name: step().network.name })}</strong>
                <p role="status">{t("app.socialFollow.followedBody")}</p>
              </div>
            )}
          </Match>
          <Match when={props.step.kind === "ask"}>
            <div class="social-follow-toast-copy">
              <strong id={titleId}>{t("app.socialFollow.title")}</strong>
              <p>{t("app.socialFollow.description")}</p>
            </div>
            {networkList()}
          </Match>
        </Switch>
      </div>

      <IconButton
        class="social-follow-toast-close"
        size="icon-xs"
        variant="ghost"
        label={t("common.close")}
        onClick={() => props.onClose()}
      >
        <X aria-hidden="true" />
      </IconButton>
    </section>
  );
}
