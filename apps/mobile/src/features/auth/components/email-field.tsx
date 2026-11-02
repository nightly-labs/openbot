import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type Ref, useState } from "react";
import { StyleSheet, TextInput, type TextInputInstance, View } from "react-native";
import Animated from "react-native-reanimated";

import { SIGN_IN_CONTROL_HEIGHT, useSignInColors } from "@/features/auth/components/sign-in-colors";
import { useShake } from "@/features/auth/components/use-shake";
import { selectionColorProps } from "@/shared/lib/selection-color";

interface EmailFieldProps {
  ref?: Ref<TextInputInstance>;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  invalid: boolean;
  rejection: number;
  editable: boolean;
  /** The field stays mounted and only shows or hides, so focus never waits for a mount. */
  visible: boolean;
  reduced: boolean;
}

/** The email field of the email step. A lavender ring marks focus; a red ring marks an error. */
export function EmailField({
  ref,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  label,
  invalid,
  rejection,
  editable,
  visible,
  reduced,
}: EmailFieldProps) {
  const colors = useSignInColors();
  const [focused, setFocused] = useState(false);
  const shake = useShake(rejection, reduced);
  return (
    // The field comes down 8 pt into the top slot when the buttons below it are done.
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={{
        opacity: visible ? 1 : 0,
        transform: [{ translateY: visible || reduced ? 0 : -8 }],
        transitionProperty: ["opacity", "transform"],
        transitionDuration: reduced ? 0 : 220,
        transitionTimingFunction: "ease-out",
      }}
    >
      <Animated.View
        style={[
          shake,
          {
            height: SIGN_IN_CONTROL_HEIGHT,
            borderRadius: colors.radius,
            borderCurve: "continuous",
            backgroundColor: colors.surface,
          },
        ]}
      >
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={editable && visible}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          accessibilityLabel={label}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="send"
          submitBehavior="submit"
          maxLength={INPUT_LIMITS.email}
          {...selectionColorProps(colors.brand)}
          className="flex-1 px-4 font-sans text-[17px]"
          style={{ color: colors.text }}
        />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View
            style={{
              flex: 1,
              borderRadius: colors.radius,
              borderCurve: "continuous",
              borderWidth: 1.5,
              borderColor: invalid ? colors.danger : colors.brand,
              opacity: invalid || focused ? 1 : 0,
              transitionProperty: ["opacity", "borderColor"],
              transitionDuration: reduced ? 0 : 160,
              transitionTimingFunction: "ease-out",
            }}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}
