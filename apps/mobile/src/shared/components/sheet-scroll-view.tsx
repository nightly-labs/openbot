import { HeaderHeightContext, HeaderShownContext } from "expo-router/react-navigation";
import { type PropsWithChildren, type ReactNode, useContext } from "react";
import { ScrollView, type ScrollViewProps, View } from "react-native";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { isIOS } from "@/shared/lib/platform";

interface SheetScrollViewProps extends PropsWithChildren {
  className?: string;
  contentContainerClassName?: string;
  contentInsetAdjustmentBehavior?: ScrollViewProps["contentInsetAdjustmentBehavior"];
  header?: ReactNode;
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
  scrollEdgeEffect = true,
  keyboardDismissMode,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator = false,
}: SheetScrollViewProps) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const headerShown = useContext(HeaderShownContext);
  const nativeHeader = isIOS && headerShown && !header;
  const showCustomEdge = scrollEdgeEffect && !nativeHeader;

  return (
    <ScrollView
      className={className}
      bounces={false}
      alwaysBounceVertical={false}
      overScrollMode="never"
      contentInsetAdjustmentBehavior={nativeHeader ? "never" : contentInsetAdjustmentBehavior}
      keyboardDismissMode={keyboardDismissMode}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      stickyHeaderIndices={showCustomEdge ? [0] : undefined}
    >
      <View className="z-10" style={header ? undefined : { height: 1, marginBottom: -1 }}>
        {showCustomEdge ? (
          <SheetScrollEdgeEffect
            style={
              header
                ? { bottom: -24, left: 0, position: "absolute", right: 0, top: 0 }
                : { height: 34, left: 0, position: "absolute", right: 0, top: 0 }
            }
          />
        ) : null}
        {header}
      </View>
      <View style={nativeHeader ? { paddingTop: headerHeight } : undefined}>
        <View className={contentContainerClassName}>{children}</View>
      </View>
    </ScrollView>
  );
}
