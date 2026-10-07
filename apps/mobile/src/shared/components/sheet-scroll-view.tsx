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
  /** False stops the scroll that keeps a focused field and the content above the keyboard. */
  keyboardAware?: boolean;
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
}: SheetScrollViewProps) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const headerShown = useContext(HeaderShownContext);
  const nativeHeader = isIOS && headerShown && !header;
  const stickyEdge = scrollEdgeEffect && !nativeHeader;
  // Android draws no blur at the sheet edge. A sticky header gets the opaque sheet color instead.
  const showCustomEdge = stickyEdge && isIOS;
  // Android: the content fades in the sheet color below the opaque native header, or at the top of a
  // sheet without a header. iOS draws its blur in the same cases.
  const androidFade = isAndroid && !header && (headerShown || scrollEdgeEffect);
  // Android: the sheet finds its scroll view only when it lays out, so nested scrolling is on from
  // the first render. A drag that starts on the list then goes to the list, and at the top of the list
  // a downward drag moves the sheet. A list that cannot scroll never takes the drag, so the content is
  // always 1 point taller than the list.
  const [viewportHeight, setViewportHeight] = useState(0);
  const androidScrollProps = isAndroid
    ? {
        nestedScrollEnabled: true,
        onLayout: (event: LayoutChangeEvent) => setViewportHeight(event.nativeEvent.layout.height),
        contentContainerStyle: viewportHeight > 0 ? { minHeight: viewportHeight + 1 } : undefined,
      }
    : null;

  return (
    <View style={{ flex: 1 }}>
      <StyledKeyboardAwareScrollView
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
        <View className={contentContainerClassName}>{children}</View>
      </StyledKeyboardAwareScrollView>
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
