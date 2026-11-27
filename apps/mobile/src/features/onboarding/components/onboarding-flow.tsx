import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { router } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, StyleSheet, View, type ViewInstance } from "react-native";
import { KeyboardAvoidingView, KeyboardController } from "react-native-keyboard-controller";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import type { AgentColorValue } from "@/features/agents/components/agent-appearance-picker";
import type { WelcomeHandOff } from "@/features/agents/components/empty-agents-scene";
import { InstructionsLimit, instructionsTooLong } from "@/features/agents/components/instructions-limit";
import { newAvatarSeed } from "@/features/agents/model/avatar-candidates";
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

const TINT_ALPHA = "14";
const TINT_MS = 320;
const CHOICE_TINTS = CHOICE_SWATCHES.map((color) => `${color}${TINT_ALPHA}`);
const HERO_STEPS: ReadonlySet<Step> = new Set(["look", "name", "role", "task", "ready"]);
const TYPING_STEPS: ReadonlySet<Step> = new Set(["name", "role", "task"]);
const CHAT_OPEN_DEADLINE_MS = 1200;
const CHARACTERS_OUT_MS = 300;

function agentSteps(custom: boolean): readonly Step[] {
  return custom ? ["agent", "look", "name", "role", "task", "ready"] : ["agent", "name", "task", "ready"];
}

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

function FadeLayer({
  visible,
  motion,
  delayIn = 0,
  tint,
}: {
  visible: boolean;
  motion: OnboardingMotion;
  delayIn?: number;
  tint: string | undefined;
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
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: tint,
            transitionProperty: "backgroundColor",
            transitionDuration: motion === "none" ? 0 : TINT_MS,
            transitionTimingFunction: EASE_OUT_CSS,
          },
        ]}
      />
    </Animated.View>
  );
}

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

export function OnboardingFlow({ onFinish }: { onFinish: (welcome?: WelcomeHandOff) => void }) {
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
  const [customSeed, setCustomSeed] = useState(newAvatarSeed);
  const [customColor, setCustomColor] = useState<AgentColorValue>({ hue: null, color: null });
  const [customDescription, setCustomDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ agentId: string; withTask: boolean } | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const creating = useRef(false);
  const stepRef = useRef<Step>("hello");
  useEffect(() => {
    stepRef.current = step;
    mobileAnalytics.track("onboarding_step", { step, action: "viewed" });
  }, [step]);

  const [slots, setSlots] = useState<Partial<Record<Step, HeroSlotRect>>>({});
  const [heroOrigin, setHeroOrigin] = useState({ x: 0, y: 0 });
  const heroLayer = useRef<ViewInstance>(null);
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
        color: null,
        description: t(role.description),
        roleTitle: t(role.title),
        ideas: role.ideas,
      }
    : {
        seed: customSeed,
        hue: customColor.hue,
        color: customColor.color,
        description: customDescription,
        roleTitle: null,
        ideas: CUSTOM_AGENT_IDEAS,
      };
  const draftColor = avatarHeadColor(draft.seed, draft.hue, draft.color);
  const action = String(useCSSVariable("--openbot-action") ?? "#f0f0f0");
  const trimmedName = name.trim();

  const online = servers.some((server) => server.state === "online");
  const connecting = online
    ? null
    : (servers.find((server) => server.state === "connecting" || server.state === "unknown") ?? null);
  const needsServer = !online;

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

  useEffect(() => {
    if (step === "hello") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, step]);

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
        firstTask,
        avatarSeed: draft.seed,
        avatarHue: draft.hue,
        avatarColor: draft.color,
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
        hue={customColor.hue}
        color={customColor.color}
        drag={heroDrag}
        onSeedChange={setCustomSeed}
        onColorChange={setCustomColor}
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
      <FadeLayer
        visible={step === "agent"}
        motion={motion}
        delayIn={step === "agent" && direction === 1 ? STAGGER_MS * 3 : 0}
        tint={CHOICE_TINTS[choice]}
      />
      <FadeLayer visible={drafting} motion={motion} tint={`${draftColor}${TINT_ALPHA}`} />
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right }}
      >
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
            color={draft.color}
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
