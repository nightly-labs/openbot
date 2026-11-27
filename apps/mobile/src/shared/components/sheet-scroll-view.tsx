import type { NativeStackHeaderProps } from "expo-router/native-stack";
import { HeaderHeightContext, HeaderShownContext, NavigationContext } from "expo-router/react-navigation";
import { type PropsWithChildren, type ReactNode, type Ref, useContext, useLayoutEffect, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  type ScrollViewProps,
  useWindowDimensions,
  View,
  type ViewInstance,
} from "react-native";
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { AndroidBlurHeader, AndroidBlurTarget } from "@/shared/components/android-header-blur";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { isSheetHeader } from "@/shared/lib/sheet-header";

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
  keyboardAware?: boolean;
  androidNativeHeader?: boolean;
  scrollRef?: Ref<KeyboardAwareScrollViewRef>;
  onScroll?: ScrollViewProps["onScroll"];
  onContentSizeChange?: ScrollViewProps["onContentSizeChange"];
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
  keyboardAware = true,
  androidNativeHeader = false,
  scrollRef,
  onScroll,
  onContentSizeChange,
}: SheetScrollViewProps) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const headerShown = useContext(HeaderShownContext);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [sheetWidth, setSheetWidth] = useState<number | null>(null);
  const sideInsets = sheetWidth === null || sheetWidth >= windowWidth - 1;
  const androidBlurHeader = ANDROID_BLUR && headerShown && !header && headerOverlaysContent && !androidNativeHeader;
  const blurTarget = useRef<ViewInstance>(null);
  const navigation = useContext(NavigationContext);
  useLayoutEffect(() => {
    if (!androidBlurHeader || !navigation) return;
    navigation.setOptions({
      headerTransparent: true,
      header: ({ options, back, navigation: stack }: NativeStackHeaderProps) => (
        <AndroidBlurHeader
          options={options}
          back={back}
          navigation={stack}
          blurTarget={blurTarget}
          underStatusBar={!isSheetHeader(options)}
        />
      ),
    });
    return () => navigation.setOptions({ header: undefined, headerTransparent: false });
  }, [androidBlurHeader, navigation]);
  const nativeHeader = isIOS && headerShown && !header;
  const stickyEdge = scrollEdgeEffect && !nativeHeader;
  const showCustomEdge = stickyEdge && isIOS;
  const androidFade = isAndroid && !header && (headerShown || scrollEdgeEffect) && !androidBlurHeader;
  const [viewportHeight, setViewportHeight] = useState(0);
  const androidScrollProps = isAndroid
    ? {
        nestedScrollEnabled: true,
        onLayout: (event: LayoutChangeEvent) => setViewportHeight(event.nativeEvent.layout.height),
        contentContainerStyle: viewportHeight > 0 ? { minHeight: viewportHeight + 1 } : undefined,
      }
    : null;

  return (
    <View style={{ flex: 1 }} onLayout={(event) => setSheetWidth(event.nativeEvent.layout.width)}>
      <AndroidBlurTarget target={blurTarget} surface="sheet" enabled={androidBlurHeader}>
        <StyledKeyboardAwareScrollView
          ref={scrollRef}
          className={className}
          enabled={keyboardAware}
          bottomOffset={16}
          disableScrollOnKeyboardHide
          mode="insets"
          automaticallyAdjustKeyboardInsets={false}
          style={{ flex: 1 }}
          alwaysBounceVertical={false}
          {...androidScrollProps}
          overScrollMode="auto"
          contentInsetAdjustmentBehavior={
            nativeHeader ? (headerOverlaysContent ? "automatic" : "never") : contentInsetAdjustmentBehavior
          }
          keyboardDismissMode={keyboardDismissMode}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          stickyHeaderIndices={stickyEdge ? [0] : undefined}
          onScroll={onScroll}
          scrollEventThrottle={onScroll ? 16 : undefined}
          onContentSizeChange={onContentSizeChange}
        >
          <View
            className={isAndroid && stickyEdge && header ? "z-10 bg-sheet" : "z-10"}
            style={header ? undefined : { height: 1, marginBottom: -1 }}
          >
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
          {androidBlurHeader ? <View style={{ height: headerHeight }} /> : null}
          <View style={sideInsets ? { paddingLeft: insets.left, paddingRight: insets.right } : undefined}>
            <View className={contentContainerClassName}>{children}</View>
          </View>
        </StyledKeyboardAwareScrollView>
      </AndroidBlurTarget>
      {nativeHeader && headerOverlaysContent ? (
        <SheetScrollEdgeEffect
          surface="sheet"
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: headerHeight + 48 }}
        />
      ) : null}
      {androidFade ? (
        <SheetScrollEdgeEffect
          surface="sheet"
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: 32 }}
        />
      ) : null}
    </View>
  );
}
