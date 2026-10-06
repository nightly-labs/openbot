import { HeaderHeightContext, HeaderShownContext } from "expo-router/react-navigation";
import { type PropsWithChildren, type ReactNode, useContext, useState } from "react";
import { type LayoutChangeEvent, type ScrollViewProps, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { withUniwind } from "uniwind";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { isAndroid, isIOS } from "@/shared/lib/platform";

const StyledKeyboardAwareScrollView = withUniwind(KeyboardAwareScrollView);

interface SheetScrollViewProps extends PropsWithChildren {
  className?: string;
  contentContainerClassName?: string;
  contentInsetAdjustmentBehavior?: ScrollViewProps["contentInsetAdjustmentBehavior"];
  header?: ReactNode;
  headerOverlaysContent?: boolean;
  scrollEdgeEffect?: boolean;
  keyboardDismissMode?: ScrollViewProps["keyboardDismissMode"];
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
  showsVerticalScrollIndicator?: boolean;
}

export function SheetScrollView({
  children,
  className = "bg-sheet",
  contentContainerClassName,
  contentInsetAdjustmentBehavior = "automatic",
  header,
  headerOverlaysContent = true,
  scrollEdgeEffect = true,
  keyboardDismissMode,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator = false,
}: SheetScrollViewProps) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const headerShown = useContext(HeaderShownContext);
  const nativeHeader = isIOS && headerShown && !header;
  const showCustomEdge = scrollEdgeEffect && !nativeHeader;
  // Android: the sheet leaves a drag that starts on a nested-scrolling list to that list. A list that
  // cannot scroll never takes the drag, so the sheet would not close. Only a list that can scroll
  // reports nested scrolling.
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollable = contentHeight > viewportHeight + 1;
  const androidScrollProps = isAndroid
    ? {
        nestedScrollEnabled: scrollable,
        onLayout: (event: LayoutChangeEvent) => setViewportHeight(event.nativeEvent.layout.height),
        onContentSizeChange: (_width: number, height: number) => setContentHeight(height),
      }
    : null;

  return (
    <View style={{ flex: 1 }}>
      <StyledKeyboardAwareScrollView
        className={className}
        bottomOffset={16}
        disableScrollOnKeyboardHide
        mode="insets"
        automaticallyAdjustKeyboardInsets={false}
        style={{ flex: 1 }}
        alwaysBounceVertical={false}
        // Without nested scrolling the Android sheet takes every drag, and the list cannot scroll.
        {...androidScrollProps}
        overScrollMode="auto"
        contentInsetAdjustmentBehavior={
          nativeHeader ? (headerOverlaysContent ? "automatic" : "never") : contentInsetAdjustmentBehavior
        }
        keyboardDismissMode={keyboardDismissMode}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        stickyHeaderIndices={showCustomEdge ? [0] : undefined}
      >
        <View className="z-10" style={header ? undefined : { height: 1, marginBottom: -1 }}>
          {showCustomEdge ? (
            <SheetScrollEdgeEffect
              surface="sheet"
              style={
                header
                  ? { bottom: -24, left: 0, position: "absolute", right: 0, top: 0 }
                  : { height: 34, left: 0, position: "absolute", right: 0, top: 0 }
              }
            />
          ) : null}
          {header}
        </View>
        <View className={contentContainerClassName}>{children}</View>
      </StyledKeyboardAwareScrollView>
      {nativeHeader && headerOverlaysContent ? (
        <SheetScrollEdgeEffect
          surface="sheet"
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: headerHeight + 48 }}
        />
      ) : null}
    </View>
  );
}
