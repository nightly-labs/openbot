import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarHue } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, StyleSheet, View, type ViewInstance } from "react-native";
import { KeyboardAvoidingView, KeyboardController } from "react-native-keyboard-controller";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";

import type { WelcomeHandOff } from "@/features/agents/components/empty-agents-scene";
import { InstructionsLimit, instructionsTooLong } from "@/features/agents/components/instructions-limit";
import { agentInitialMessage } from "@/features/agents/model/agent-initial-message";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { AgentStep } from "@/features/onboarding/components/agent-step";
import { ConversationStep } from "@/features/onboarding/components/conversation-step";
import { HelloStep } from "@/features/onboarding/components/hello-step";
import { LookStep } from "@/features/onboarding/components/look-step";
import { NameStep } from "@/features/onboarding/components/name-step";
import { HeroSlotProvider, type HeroSlotRect, OnboardingHero } from "@/features/onboarding/components/onboarding-hero";
import {
  EASE_OUT_CSS,
  type OnboardingMotion,
  STAGGER_MS,
  stepEntering,
  stepExiting,
  useOnboardingMotion,
} from "@/features/onboarding/components/onboarding-motion";
import { type FooterAction, OnboardingFooter } from "@/features/onboarding/components/onboarding-parts";
import { ReadyStep } from "@/features/onboarding/components/ready-step";
import { ServerStep } from "@/features/onboarding/components/server-step";
import {
  CHOICE_SWATCHES,
  CUSTOM_AGENT_IDEAS,
  CUSTOM_CHOICE,
  ONBOARDING_ROLES,
} from "@/features/onboarding/model/onboarding-roles";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import {
  refreshHostedServerAvailability,
  useHostedServerAvailability,
} from "@/features/servers/model/hosted-server-availability";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { devFeatureOverride } from "@/shared/lib/dev-feature-overrides";
import { haptics } from "@/shared/lib/haptics";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { useText } from "@/shared/lib/text";

type Step = "hello" | "server" | "agent" | "look" | "name" | "role" | "task" | "ready";

// The whole screen takes the colour of the agent: softly, so text keeps its contrast.
const TINT_ALPHA = "14";
const TINT_MS = 320;
const CHOICE_TINTS = CHOICE_SWATCHES.map((color) => `${color}${TINT_ALPHA}`);
// The steps where the agent stands on the screen as the hero.
const HERO_STEPS: ReadonlySet<Step> = new Set(["look", "name", "role", "task", "ready"]);
// The steps with a text field. Only these make room for the keyboard.
const TYPING_STEPS: ReadonlySet<Step> = new Set(["name", "role", "task"]);
// The chat opens over the flow. If the end of that transition is never reported, the flow still
// ends behind the chat.
const CHAT_OPEN_DEADLINE_MS = 1200;
// How long characters take to leave before the next step comes in.
const CHARACTERS_OUT_MS = 300;

/** The steps that make the agent, in order. The progress bar counts them. */
function agentSteps(custom: boolean): readonly Step[] {
  return custom ? ["agent", "look", "name", "role", "task", "ready"] : ["agent", "name", "task", "ready"];
}

/** Where Back goes. The welcome has no step before it, and the last step follows a created agent. */
function previousStep(step: Step, needsServer: boolean, custom: boolean): Step | null {
  switch (step) {
    case "server":
      return "hello";
    case "agent":
      return needsServer ? "server" : "hello";
    case "look":
      return "agent";
    case "name":
      return custom ? "look" : "agent";
    case "role":
      return "name";
    case "task":
      return custom ? "role" : "name";
    case "hello":
    case "ready":
      return null;
  }
}

/**
 * A layer that fades in and out with the steps that use it. `delayIn` holds the fade-in back until
 * the content it belongs to starts to arrive, so the colour never comes before the content.
 */
function FadeLayer({
  visible,
  motion,
  delayIn = 0,
  children,
}: {
  visible: boolean;
  motion: OnboardingMotion;
  delayIn?: number;
  children: ReactNode;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: visible ? 1 : 0,
          transitionProperty: "opacity",
          transitionDuration: motion === "none" ? 0 : TINT_MS,
          transitionDelay: visible && motion !== "none" ? delayIn : 0,
          transitionTimingFunction: EASE_OUT_CSS,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Where the user is while the agent takes shape: one dot per step of the way, the current step
 * stretched into a pill in the agent's colour. Done steps keep the colour, softer, and the steps
 * left stay visible as plain dots, so the row tells how far it is to the end.
 */
function StepProgress({
  steps,
  current,
  color,
  motion,
}: {
  steps: readonly Step[];
  current: number;
  color: string;
  motion: OnboardingMotion;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  // Every dot sets its colour in the style. A class colour under an unset style colour draws nothing.
  const foreground = String(useThemeColor("foreground"));
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("mobile.onboarding.progress", { current: current + 1, total: steps.length })}
      accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
      className="absolute right-0 left-0 flex-row items-center justify-center gap-1.5"
      style={{ top: insets.top + 6 }}
    >
      {steps.map((item, index) => (
        <Animated.View
          key={item}
          className="h-2 rounded-full"
          style={{
            width: index === current ? 26 : 8,
            backgroundColor: index <= current ? color : foreground,
            opacity: index === current ? 1 : index < current ? 0.5 : 0.22,
            transitionProperty: ["width", "backgroundColor", "opacity"],
            transitionDuration: motion === "none" ? 0 : 340,
            transitionTimingFunction: EASE_OUT_CSS,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The first run of an account: a welcome, a server when the account has none, and a first agent
 * from a starting role or from scratch, with a name and a first task. From the picker on, the
 * agent is one character that moves from step to step and talks to the user. Every step before
 * the agent exists can be skipped. The flow creates nothing until the user chooses Create.
 */
export function OnboardingFlow({
  onFinish,
}: {
  /** `welcome` is set when the user skips the welcome: the empty home takes over its screen. */
  onFinish: (welcome?: WelcomeHandOff) => void;
}) {
  const { t, errorMessage } = useText();
  const insets = useSafeAreaInsets();
  const motion = useOnboardingMotion();
  const { session, signOut } = useMobileSession();
  const { servers, createAgent } = useMobileWorkspace();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [step, setStep] = useState<Step>("hello");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [choice, setChoice] = useState(0);
  const choiceProgress = useSharedValue(0);
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  // An agent from scratch starts with a new look and the automatic colour, as in the add-agent sheet.
  const [customSeed, setCustomSeed] = useState(() => `mobile:${Crypto.randomUUID().replaceAll("-", "")}`);
  const [customHue, setCustomHue] = useState<AvatarHue | null>(null);
  const [customDescription, setCustomDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ agentId: string; withTask: boolean } | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const creating = useRef(false);
  // Read by the step changes, which run after a delay and must report the step that the user left.
  const stepRef = useRef<Step>("hello");
  useEffect(() => {
    stepRef.current = step;
    mobileAnalytics.track("onboarding_step", { step, action: "viewed" });
  }, [step]);

  // The hero: where each step wants it, where its layer is, and the swipe of the look step.
  const [slots, setSlots] = useState<Partial<Record<Step, HeroSlotRect>>>({});
  const [heroOrigin, setHeroOrigin] = useState({ x: 0, y: 0 });
  const heroLayer = useRef<ViewInstance>(null);
  // The height of the step area with no keyboard. A step without a text field keeps it while the
  // keyboard closes over it, so its characters stand where they will stay and the hero lands on
  // them, not above them.
  const [restingHeight, setRestingHeight] = useState<number | null>(null);
  const heroDrag = useSharedValue(0);
  const [pulse, setPulse] = useState(0);
  const reporters = useRef(new Map<Step, (rect: HeroSlotRect) => void>());
  const reporterFor = (target: Step) => {
    let reporter = reporters.current.get(target);
    if (!reporter) {
      reporter = (rect: HeroSlotRect) =>
        setSlots((current) => {
          const known = current[target];
          if (known && known.cx === rect.cx && known.cy === rect.cy && known.size === rect.size) return current;
          return { ...current, [target]: rect };
        });
      reporters.current.set(target, reporter);
    }
    return reporter;
  };

  // The flow has its own horizontal swipes, and the server drawer has nothing to do in it yet, so
  // the pan that opens the drawer stays off until the flow ends.
  const { setOpeningBlocked } = useAppDrawer();
  useEffect(() => {
    setOpeningBlocked(true);
    return () => setOpeningBlocked(false);
  }, [setOpeningBlocked]);

  const role = choice === CUSTOM_CHOICE ? null : (ONBOARDING_ROLES[choice] ?? null);
  const custom = role === null;
  const draft = role
    ? {
        seed: role.avatarSeed,
        hue: role.avatarHue,
        description: t(role.description),
        roleTitle: t(role.title),
        ideas: role.ideas,
      }
    : { seed: customSeed, hue: customHue, description: customDescription, roleTitle: null, ideas: CUSTOM_AGENT_IDEAS };
  const draftColor = getBloubAvatarColor(draft.seed, draft.hue);
  // Before there is an agent colour, and for an agent made from scratch in the picker, the theme's
  // action colour (white in dark mode, black in light mode) stands in for it.
  const action = String(useCSSVariable("--openbot-action") ?? "#f0f0f0");
  const trimmedName = name.trim();

  const online = servers.some((server) => server.state === "online");
  // A server on its way shows the loader. One that could not connect shows the choices again, so the
  // user can try another way.
  const connecting = online
    ? null
    : (servers.find((server) => server.state === "connecting" || server.state === "unknown") ?? null);
  // The server step shows only while the account has no connected server.
  const needsServer = !online;

  // A cloud server is a choice only when the account can have one, as in the server drawer.
  const accountHasPlans = useHostedServerAvailability(
    (state) => session !== null && state.userId === session.user.id && state.available,
  );
  const cloudServersOn = useMobileFeature(session?.apiUrl ?? "", "cloudServers");
  const showsPlans = devFeatureOverride("cloudServers") ?? (accountHasPlans && cloudServersOn);
  useEffect(() => {
    if (!session || step !== "server") return;
    void refreshHostedServerAvailability(session.user.id, hostedServerCalls(session));
    void refreshMobileFeatures(session.apiUrl);
  }, [session, step]);

  // The keyboard closes while the field that opened it is still there. On Android, a focused field
  // that goes with its step's exit animation leaves the keyboard open, with nothing to type into
  // and no way to close it.
  const go = useCallback(
    (next: Step, nextDirection: 1 | -1) => {
      void KeyboardController.dismiss();
      heroDrag.set(0);
      mobileAnalytics.track("onboarding_step", {
        step: stepRef.current,
        action: nextDirection === 1 ? "next" : "back",
      });
      setDirection(nextDirection);
      setStep(next);
    },
    [heroDrag],
  );

  // The welcome and the picker play their characters out before the next step comes in: the
  // welcome's crowd flies off, the picker's neighbours step aside for the one that was chosen.
  const [leaving, setLeaving] = useState<"forward" | "back" | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );
  const leaveTo = useCallback(
    (next: Step, nextDirection: 1 | -1) => {
      if (motion !== "full") {
        go(next, nextDirection);
        return;
      }
      if (leaveTimer.current) return;
      setLeaving(nextDirection === 1 ? "forward" : "back");
      leaveTimer.current = setTimeout(() => {
        leaveTimer.current = null;
        setLeaving(null);
        go(next, nextDirection);
      }, CHARACTERS_OUT_MS);
    },
    [go, motion],
  );

  // A server that was just joined or set up comes online: the flow moves on by itself.
  useEffect(() => {
    if (step !== "server" || !online) return;
    void haptics.notification("success");
    go("agent", 1);
  }, [go, online, step]);

  const previous = previousStep(step, needsServer, custom);
  const back = useCallback(() => {
    if (previous === null || pending || leaving) return;
    void haptics.selection();
    if (step === "agent") leaveTo(previous, -1);
    else go(previous, -1);
  }, [go, leaveTo, leaving, pending, previous, step]);

  // The Android back button goes one step back. On the welcome it leaves the app as usual, and on
  // the last step the agent already exists, so it stays.
  useEffect(() => {
    if (step === "hello") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, step]);

  // The chat opens on top of the flow. The flow ends only when the chat covers it, so the home
  // screen never shows on the way to the chat.
  useEffect(() => {
    if (!openingChat) return;
    const unsubscribe = navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing) onFinish();
    });
    const deadline = setTimeout(() => onFinish(), CHAT_OPEN_DEADLINE_MS);
    return () => {
      unsubscribe();
      clearTimeout(deadline);
    };
  }, [navigation, onFinish, openingChat]);

  // The empty home has the layout of the welcome. Skipped on the welcome, the flow fades off the
  // same group and text, and the home's action starts where the welcome's main action stands.
  const primaryPlace = useRef<ViewInstance>(null);
  const finishing = useRef(false);
  const skip = () => {
    if (finishing.current) return;
    finishing.current = true;
    mobileAnalytics.track("onboarding_step", { step, action: "skipped" });
    mobileAnalytics.track("onboarding_completed", { skipped: true });
    void haptics.selection();
    void KeyboardController.dismiss();
    const place = step === "hello" ? primaryPlace.current : null;
    if (!place) {
      onFinish();
      return;
    }
    const label = t("mobile.onboarding.hello.start");
    place.measureInWindow((x, _y, width) => onFinish(width > 0 ? { label, x, width } : undefined));
  };
  useEffect(
    () => () => {
      void KeyboardController.dismiss();
    },
    [],
  );

  const connectComputer = () => {
    Alert.alert(t("mobile.onboarding.server.computerTitle"), t("mobile.onboarding.server.computerSteps"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.onboarding.server.signOut"),
        style: "destructive",
        onPress: () => void signOut().catch(() => undefined),
      },
    ]);
  };

  const create = async (firstTask: string) => {
    if (creating.current) return;
    creating.current = true;
    setPending(true);
    setError(null);
    try {
      const agentId = await createAgent({
        name: trimmedName,
        description: draft.description.trim(),
        initialMessage: agentInitialMessage(draft.description, firstTask),
        avatarSeed: draft.seed,
        avatarHue: draft.hue,
      });
      setCreated({ agentId, withTask: firstTask.trim().length > 0 });
      go("ready", 1);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.onboarding.task.failed")));
    } finally {
      creating.current = false;
      setPending(false);
    }
  };

  const openChat = () => {
    if (!created || openingChat) return;
    setOpeningChat(true);
    mobileAnalytics.track("onboarding_step", { step: "ready", action: "next" });
    mobileAnalytics.track("onboarding_completed", { skipped: false });
    router.push({ pathname: "/chat/[agentId]", params: { agentId: created.agentId } });
  };

  // The main action wears the agent's colour from the picker on: the one in the middle while
  // choosing, then the chosen one. Before that, it is the theme's black or white.
  const accent =
    step === "agent" ? (custom ? undefined : CHOICE_SWATCHES[choice]) : HERO_STEPS.has(step) ? draftColor : undefined;
  const footerAction: FooterAction | null = (() => {
    switch (step) {
      case "hello":
        return {
          label: t("mobile.onboarding.hello.start"),
          onPress: () => leaveTo(needsServer ? "server" : "agent", 1),
        };
      case "server":
        return null;
      case "agent":
        return custom
          ? { label: t("mobile.onboarding.agent.startFromScratch"), onPress: () => leaveTo("look", 1) }
          : {
              label: t("mobile.onboarding.agent.choose", { role: draft.roleTitle ?? "" }),
              onPress: () => leaveTo("name", 1),
            };
      case "look":
        return { label: t("mobile.onboarding.name.continue"), onPress: () => go("name", 1) };
      case "name":
        return {
          label: t("mobile.onboarding.name.continue"),
          disabled: !trimmedName,
          onPress: () => go(custom ? "role" : "task", 1),
        };
      case "role":
        return {
          label: t("mobile.onboarding.name.continue"),
          disabled: instructionsTooLong(customDescription),
          onPress: () => go("task", 1),
        };
      case "task":
        return {
          label: pending
            ? t("mobile.onboarding.task.creating")
            : t("mobile.onboarding.task.create", { name: trimmedName }),
          disabled: pending,
          onPress: () => void create(task),
        };
      case "ready":
        return { label: t("mobile.onboarding.ready.open"), disabled: openingChat, onPress: openChat };
    }
  })();

  const primary = footerAction ? { ...footerAction, color: accent } : null;

  const content =
    step === "hello" ? (
      <HelloStep motion={motion} leaving={leaving !== null} />
    ) : step === "server" ? (
      <ServerStep
        motion={motion}
        connecting={connecting}
        onComputer={connectComputer}
        onCloud={
          showsPlans ? () => router.push({ pathname: "/hosted-server", params: { entryPoint: "onboarding" } }) : null
        }
        onInvitation={() => router.push("/add-server")}
        onBack={previous !== null ? back : null}
        onSkip={skip}
      />
    ) : step === "agent" ? (
      <AgentStep
        motion={motion}
        choice={choice}
        progress={choiceProgress}
        leaving={leaving}
        direction={direction}
        onChoiceChange={setChoice}
      />
    ) : step === "look" ? (
      <LookStep
        motion={motion}
        seed={customSeed}
        hue={customHue}
        drag={heroDrag}
        onSeedChange={setCustomSeed}
        onHueChange={setCustomHue}
        onPulse={() => setPulse((value) => value + 1)}
      />
    ) : step === "name" ? (
      <NameStep
        motion={motion}
        color={draftColor}
        name={name}
        onNameChange={setName}
        onContinue={() => go(custom ? "role" : "task", 1)}
      />
    ) : step === "role" ? (
      <ConversationStep
        motion={motion}
        name={trimmedName}
        caption={null}
        question={t("mobile.onboarding.role.question")}
        ideas={ONBOARDING_ROLES.map((item) => t(item.description))}
        value={customDescription}
        onChange={setCustomDescription}
        label={t("mobile.onboarding.custom.roleLabel")}
        placeholder={t("mobile.onboarding.custom.rolePlaceholder")}
        color={draftColor}
        disabled={false}
      >
        <InstructionsLimit text={customDescription} />
      </ConversationStep>
    ) : step === "task" ? (
      <ConversationStep
        motion={motion}
        name={trimmedName}
        caption={draft.roleTitle}
        question={t("mobile.onboarding.task.question")}
        ideas={draft.ideas.map((key) => t(key))}
        value={task}
        onChange={setTask}
        label={t("mobile.onboarding.task.label")}
        placeholder={t("mobile.onboarding.task.placeholder")}
        maxLength={INPUT_LIMITS.messageText}
        color={draftColor}
        disabled={pending}
        action={{ label: t("mobile.onboarding.task.withoutTask"), onPress: () => void create("") }}
      >
        {error ? (
          <Typography.Paragraph accessibilityRole="alert" type="body-sm" align="center" className="text-danger-text">
            {error}
          </Typography.Paragraph>
        ) : null}
      </ConversationStep>
    ) : step === "ready" && created ? (
      <ReadyStep
        motion={motion}
        color={draftColor}
        roleTitle={draft.roleTitle}
        name={trimmedName}
        withTask={created.withTask}
      />
    ) : null;

  const drafting = HERO_STEPS.has(step);
  const sequence = agentSteps(custom);
  const position = sequence.indexOf(step);
  const heroSlot = slots[step] ?? (drafting ? null : (slots.agent ?? null));
  const heroMood =
    step === "name"
      ? trimmedName
        ? "responded"
        : "waiting"
      : step === "ready" || step === "look" || step === "agent"
        ? "responded"
        : "idle";

  return (
    <View className="flex-1 bg-background">
      {/* The picker's colour arrives with its stage, not before it. */}
      <FadeLayer
        visible={step === "agent"}
        motion={motion}
        delayIn={step === "agent" && direction === 1 ? STAGGER_MS * 3 : 0}
      >
        {/* The colour changes once per choice, not on each frame of a swipe. */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: CHOICE_TINTS[choice],
              transitionProperty: "backgroundColor",
              transitionDuration: motion === "none" ? 0 : TINT_MS,
              transitionTimingFunction: EASE_OUT_CSS,
            },
          ]}
        />
      </FadeLayer>
      <FadeLayer visible={drafting} motion={motion}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: `${draftColor}${TINT_ALPHA}`,
              transitionProperty: "backgroundColor",
              transitionDuration: motion === "none" ? 0 : TINT_MS,
              transitionTimingFunction: EASE_OUT_CSS,
            },
          ]}
        />
      </FadeLayer>
      {/* The steps keep clear of the side insets (the iPhone Duo rail, the landscape cutout). The tints
          above stay edge to edge. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right }}
      >
        {/* Steps overlap while one leaves and the next arrives, so neither pushes the other. The
            inner view takes the keyboard padding. A step with a text field fills it; the others
            keep their height with no keyboard. The last step only fades in: its hero lands with
            its own motion. */}
        <View
          ref={heroLayer}
          collapsable={false}
          className="flex-1"
          onLayout={({ nativeEvent: { layout } }) => {
            heroLayer.current?.measureInWindow((x, y) => setHeroOrigin({ x, y }));
            if (!KeyboardController.isVisible()) setRestingHeight(layout.height);
          }}
        >
          <Animated.View
            key={step}
            entering={stepEntering(step === "ready" && motion === "full" ? "fade" : motion, direction)}
            exiting={stepExiting(motion, direction)}
            style={
              restingHeight === null || TYPING_STEPS.has(step)
                ? StyleSheet.absoluteFill
                : { position: "absolute", top: 0, left: 0, right: 0, height: restingHeight }
            }
          >
            <HeroSlotProvider value={reporterFor(step)}>{content}</HeroSlotProvider>
          </Animated.View>
          <OnboardingHero
            seed={draft.seed}
            hue={draft.hue}
            mood={heroMood}
            slot={heroSlot}
            origin={heroOrigin}
            visible={drafting}
            motion={motion}
            drag={heroDrag}
            pulse={pulse}
            celebrate={step === "ready"}
          />
        </View>
        <OnboardingFooter
          motion={motion}
          primary={primary}
          onBack={previous !== null ? back : null}
          onSkip={step !== "ready" ? skip : null}
          busy={pending || openingChat || leaving !== null}
          primaryRef={primaryPlace}
        />
      </KeyboardAvoidingView>
      {position >= 0 ? (
        <StepProgress steps={sequence} current={position} color={accent ?? action} motion={motion} />
      ) : null}
    </View>
  );
}
