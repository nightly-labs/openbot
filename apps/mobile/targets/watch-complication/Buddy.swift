import SwiftUI
import WidgetKit

enum BuddyMood {
  case calm
  case alert
  case busy
  case asleep
  case away

  init(_ data: ComplicationData) {
    if data.isLocked {
      self = .asleep
    } else if !data.isReady {
      self = .away
    } else if data.count > 0 {
      self = .alert
    } else if data.workingCount > 0 {
      self = .busy
    } else {
      self = .calm
    }
  }
}

enum BuddyPalette {
  static let top = Color(red: 0.886, green: 0.773, blue: 0.980)
  static let bottom = Color(red: 0.682, green: 0.576, blue: 0.792)
  static let ink = Color(red: 0.016, green: 0, blue: 0.027)
}

struct BuddyEyes: Shape {
  private static let left: [CGFloat] = [
    43.55, 93.61, 64.69, 81.41, 36.48, 108.04, 79.67, 83.11, 35.93, 122.88, 91.58, 90.74, 38.9, 132.69, 97.66, 98.76,
    42.44, 138.88, 100.43, 105.4, 46.9, 143.83, 101.97, 112.04, 55.08, 149.51, 101.83, 122.52, 73.01, 152.43, 94.14,
    140.23,
  ]
  private static let right: [CGFloat] = [
    145.65, 93.61, 166.79, 81.41, 140.83, 101.52, 175.58, 81.46, 138.3, 109.53, 183.18, 83.63, 137.55, 117.43, 189.67,
    87.33, 139.67, 129.39, 197.88, 95.78, 142.92, 136.32, 201.52, 102.48, 149.03, 143.86, 204.07, 112.08, 159.14,
    150.37, 203.51, 124.75, 169.28, 152.61, 199.82, 134.98,
  ]
  private static let bounds = CGRect(x: 31, y: 76, width: 178, height: 82)
  private static let lineWidth: CGFloat = 9.5

  func path(in rect: CGRect) -> Path {
    let scale = min(rect.width / Self.bounds.width, rect.height / Self.bounds.height)
    let dx = rect.midX - Self.bounds.midX * scale
    let dy = rect.midY - Self.bounds.midY * scale
    var lines = Path()
    for values in [Self.left, Self.right] {
      let points = stride(from: 0, to: values.count - 1, by: 2).map {
        CGPoint(x: values[$0] * scale + dx, y: values[$0 + 1] * scale + dy)
      }
      lines.addLines(points)
    }
    return lines.strokedPath(
      StrokeStyle(lineWidth: Self.lineWidth * scale, lineCap: .round, lineJoin: .round))
  }
}

struct BuddyClosedEyes: Shape {
  func path(in rect: CGRect) -> Path {
    let eye = rect.width * 0.36
    let gap = rect.width - eye * 2
    var lines = Path()
    for start in [rect.minX, rect.minX + eye + gap] {
      lines.move(to: CGPoint(x: start, y: rect.midY))
      lines.addQuadCurve(
        to: CGPoint(x: start + eye, y: rect.midY),
        control: CGPoint(x: start + eye / 2, y: rect.midY + rect.height * 0.9))
    }
    return lines.strokedPath(StrokeStyle(lineWidth: rect.width * 0.09, lineCap: .round))
  }
}

struct BuddyFace: View {
  @Environment(\.widgetRenderingMode) private var renderingMode
  let mood: BuddyMood
  var badge = 0
  var badgeColor = Color.orange
  var details = true
  var systemBackground = true

  private var fullColor: Bool { renderingMode == .fullColor }
  private var ink: Color { fullColor ? BuddyPalette.ink : .white }
  private var showsBadge: Bool { details && badge > 0 }

  var body: some View {
    GeometryReader { proxy in
      let side = min(proxy.size.width, proxy.size.height)
      ZStack {
        background
        eyes(side: side)
          .offset(y: showsBadge ? -side * 0.1 : -side * 0.02)
        if showsBadge {
          badgeView(side: side)
            .offset(y: side * 0.27)
        } else if details && mood == .busy {
          dots(side: side)
            .offset(y: side * 0.26)
        }
      }
      .frame(width: proxy.size.width, height: proxy.size.height)
    }
    .opacity(mood == .away ? 0.5 : 1)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private var background: some View {
    if fullColor {
      Circle().fill(LinearGradient(colors: [BuddyPalette.top, BuddyPalette.bottom], startPoint: .top, endPoint: .bottom))
    } else if systemBackground {
      AccessoryWidgetBackground()
    } else {
      Circle().fill(Color.white.opacity(0.18))
    }
  }

  @ViewBuilder
  private func eyes(side: CGFloat) -> some View {
    if mood == .asleep {
      BuddyClosedEyes()
        .fill(ink)
        .frame(width: side * 0.6, height: side * 0.14)
        .widgetAccentable()
    } else {
      BuddyEyes()
        .fill(ink)
        .frame(width: side * 0.66, height: side * 0.3)
        .scaleEffect(mood == .alert ? 1.12 : 1)
        .offset(x: mood == .busy ? side * 0.05 : 0)
        .widgetAccentable()
    }
  }

  private func badgeView(side: CGFloat) -> some View {
    Text(verbatim: badge > 99 ? "99+" : "\(badge)")
      .font(.system(size: side * 0.24, weight: .bold, design: .rounded))
      .foregroundStyle(badgeColor == .orange ? Color.black : Color.white)
      .padding(.horizontal, side * 0.08)
      .frame(minWidth: side * 0.36, minHeight: side * 0.3)
      .background(Capsule().fill(badgeColor))
      .widgetAccentable()
  }

  private func dots(side: CGFloat) -> some View {
    HStack(spacing: side * 0.05) {
      ForEach(0..<3, id: \.self) { _ in
        Circle().frame(width: side * 0.08, height: side * 0.08)
      }
    }
    .foregroundStyle(ink.opacity(0.6))
    .widgetAccentable()
  }
}
