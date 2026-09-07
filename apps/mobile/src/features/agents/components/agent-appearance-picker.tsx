import { AVATAR_HUE_OPTIONS, avatarCandidateSeeds, avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { Button } from "heroui-native";
import { type ReactNode, useMemo, useState } from "react";
import { View } from "react-native";

import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";

interface AgentAppearancePickerProps {
  seed: string;
  hue: AvatarHue | null;
  name: string;
  nameField: ReactNode;
  disabled: boolean;
  onSeedChange: (seed: string) => void;
  onHueChange: (hue: AvatarHue | null) => void;
}

export function AgentAppearancePicker({
  seed,
  hue,
  name,
  nameField,
  disabled,
  onSeedChange,
  onHueChange,
}: AgentAppearancePickerProps) {
  const [candidates, setCandidates] = useState({ seed, batch: 0 });
  const seeds = useMemo(() => avatarCandidateSeeds(candidates.seed, candidates.seed, candidates.batch), [candidates]);

  return (
    <View className="gap-4">
      <View
        className="items-center gap-2"
        accessible
        accessibilityLabel={`Avatar preview for ${name.trim() || "New agent"}`}
      >
        <BloubAvatarPreview seed={seed} hue={hue} size={144} />
      </View>
      {nameField}
      <View
        className="mt-4 flex-row flex-wrap justify-center gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel="Shape and expression"
      >
        {seeds.map((candidate, index) => (
          <Button
            key={candidate}
            isIconOnly
            className="size-16"
            variant={seed === candidate ? "secondary" : "ghost"}
            accessibilityRole="radio"
            accessibilityLabel={`Agent face ${index + 1}`}
            accessibilityState={{ checked: seed === candidate, disabled }}
            isDisabled={disabled}
            onPress={() => onSeedChange(candidate)}
          >
            <BloubAvatarPreview seed={candidate} hue={hue} size={48} />
          </Button>
        ))}
      </View>
      <Button
        variant="ghost"
        size="sm"
        className="self-center"
        isDisabled={disabled}
        onPress={() => setCandidates((current) => ({ seed, batch: current.batch + 1 }))}
      >
        <Button.Label>More faces</Button.Label>
      </Button>
      <View
        className="flex-row flex-wrap justify-center gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel="Avatar color"
      >
        {AVATAR_HUE_OPTIONS.map((option) => (
          <Button
            key={option.hue}
            isIconOnly
            variant={hue === option.hue ? "secondary" : "ghost"}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: hue === option.hue, disabled }}
            isDisabled={disabled}
            onPress={() => onHueChange(option.hue)}
          >
            <View className="size-6 rounded-full" style={{ backgroundColor: avatarHueSwatch(option.hue) }} />
          </Button>
        ))}
        <View className="w-full items-center">
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            accessibilityRole="radio"
            accessibilityLabel="Automatic"
            accessibilityState={{ checked: hue === null, disabled }}
            isDisabled={disabled}
            onPress={() => onHueChange(null)}
          >
            <Button.Label>{hue === null ? "✓ Automatic" : "Automatic"}</Button.Label>
          </Button>
        </View>
      </View>
    </View>
  );
}
