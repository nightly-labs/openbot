import SwiftUI
import UIKit
import WidgetKit

struct ComplicationView: View {
  @Environment(\.widgetFamily) private var family
  let data: ComplicationData

  private var label: String? {
    guard data.isReady, !data.text.isEmpty else { return nil }
    return data.text
  }

  var body: some View {
    switch family {
    case .accessoryRectangular:
      Group {
        if data.isReady, let agent = data.agent {
          AgentCard(agent: agent, moreWaiting: data.moreWaiting ?? 0, moreUnread: data.moreUnread ?? 0)
            .accessibilityElement(children: .combine)
            .accessibilityHint(data.moreLabel.map { Text($0) } ?? Text(verbatim: ""))
        } else {
          BuddyCard(data: data, label: label)
        }
      }
      .containerBackground(for: .widget) { AgentCardBackground(hex: data.isReady ? data.agent?.color : nil) }
      .widgetURL(data.agentURL)
    case .accessoryCorner:
      corner
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(data.waitingURL)
    default:
      BuddyFace(
        mood: BuddyMood(data), badge: circleBadge,
        badgeColor: data.count > 0 ? .orange : .blue)
        .accessibilityElement()
        .accessibilityLabel(label ?? "OpenBot")
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(data.waitingURL)
    }
  }

  private var circleBadge: Int {
    guard data.isReady else { return 0 }
    return data.count > 0 ? data.count : data.unreadCount
  }

  @ViewBuilder
  private var corner: some View {
    let face = BuddyFace(mood: BuddyMood(data), details: false, systemBackground: false)
    if let label {
      face.widgetLabel { Text(label) }
    } else {
      face.accessibilityElement().accessibilityLabel(Text(verbatim: "OpenBot"))
    }
  }
}

struct AgentCard: View {
  @Environment(\.showsWidgetContainerBackground) private var showsBackground
  @Environment(\.widgetContentMargins) private var margins
  let agent: ComplicationAgent
  let moreWaiting: Int
  let moreUnread: Int

  private static let peekSide: CGFloat = 62
  private static let peekInset: CGFloat = 30

  var body: some View {
    HStack(alignment: .top, spacing: 6) {
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 3) {
          Text(agent.name)
            .font(.headline)
            .lineLimit(1)
            .widgetAccentable()
          if moreWaiting > 0 {
            MorePill(count: moreWaiting, color: .orange)
          }
          if moreUnread > 0 {
            MorePill(count: moreUnread, color: .blue)
          }
        }
        Text(agent.status)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(statusColor)
          .lineLimit(1)
        if let line = agent.line {
          Text(line)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      if !showsBackground {
        AgentPicture(agent: agent, side: 26)
      }
    }
    .padding(.trailing, showsBackground ? Self.peekInset : 0)
    .overlay(alignment: .trailing) {
      if showsBackground {
        AgentPicture(agent: agent, side: Self.peekSide)
          .rotationEffect(.degrees(-8))
          .offset(x: margins.trailing + Self.peekSide * 0.3)
      }
    }
  }

  private var statusColor: Color {
    if agent.isWaiting { return .orange }
    if agent.isWorking { return showsBackground ? Color(red: 0.56, green: 0.77, blue: 1) : .blue }
    return .secondary
  }
}

struct MorePill: View {
  let count: Int
  let color: Color

  var body: some View {
    Text(verbatim: count > 99 ? "+99" : "+\(count)")
      .font(.caption2.weight(.bold))
      .monospacedDigit()
      .foregroundStyle(color == .orange ? Color.black : Color.white)
      .padding(.horizontal, 5)
      .padding(.vertical, 1)
      .background(Capsule().fill(color))
      .fixedSize()
      .widgetAccentable()
      .accessibilityHidden(true)
  }
}

struct AgentPicture: View {
  let agent: ComplicationAgent
  let side: CGFloat

  private static let pictureScale: CGFloat = 1.25

  var body: some View {
    Group {
      if let image = agent.image(side: side * 3) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
          .scaleEffect(Self.pictureScale)
      } else {
        ZStack {
          Circle().fill(Color(hex: agent.color) ?? BuddyPalette.bottom)
          Text(String(agent.name.prefix(1)).uppercased())
            .font(.system(size: side * 0.45, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
        }
      }
    }
    .frame(width: side, height: side)
    .clipShape(Circle())
    .accessibilityHidden(true)
  }
}

struct BuddyCard: View {
  let data: ComplicationData
  let label: String?

  var body: some View {
    HStack(spacing: 8) {
      BuddyFace(mood: BuddyMood(data), details: false, systemBackground: false)
        .frame(width: 36, height: 36)
      VStack(alignment: .leading, spacing: 1) {
        Text(verbatim: "OpenBot")
          .font(.headline)
          .widgetAccentable()
        if let label {
          Text(label)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxHeight: .infinity)
  }
}

struct AgentCardBackground: View {
  let hex: String?

  var body: some View {
    if let color = hex.flatMap(Color.init(hex:)) {
      ZStack {
        Color.black
        LinearGradient(
          stops: [
            .init(color: color.opacity(0.62), location: 0),
            .init(color: color.opacity(0.46), location: 0.45),
            .init(color: color.opacity(0.3), location: 1),
          ],
          startPoint: .top, endPoint: .bottom)
      }
    } else {
      LinearGradient(
        colors: [BuddyPalette.bottom.opacity(0.35), .black], startPoint: .top, endPoint: .bottom)
    }
  }
}

extension Color {
  init?(hex: String) {
    var digits = hex.trimmingCharacters(in: .whitespaces)
    if digits.hasPrefix("#") { digits.removeFirst() }
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
    self.init(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255)
  }
}
