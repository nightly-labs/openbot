import SwiftUI
import WidgetKit

struct ComplicationView: View {
  @Environment(\.widgetFamily) private var family
  let data: ComplicationData

  private static let gaugeLimit = 5

  var body: some View {
    if data.state == "ready" {
      ready
    } else {
      iconOnly
    }
  }

  private var symbol: String {
    data.state == "locked" ? "lock.fill" : "bubble.left.and.bubble.right.fill"
  }

  @ViewBuilder
  private var iconOnly: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: symbol)
          .font(.title3)
      }
    case .accessoryInline:
      Image(systemName: symbol)
    default:
      Image(systemName: symbol)
        .font(.title3)
        .widgetAccentable()
    }
  }

  @ViewBuilder
  private var ready: some View {
    switch family {
    case .accessoryCircular:
      if data.count > 0 {
        Gauge(value: Double(min(data.count, Self.gaugeLimit)), in: 0...Double(Self.gaugeLimit)) {
          Image(systemName: "person.fill")
        } currentValueLabel: {
          Text(verbatim: "\(data.count)")
        }
        .gaugeStyle(.accessoryCircular)
        .tint(.orange)
        .accessibilityLabel(data.text)
      } else {
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: "checkmark")
            .font(.title3.weight(.semibold))
        }
        .accessibilityLabel(data.text)
      }
    case .accessoryCorner:
      Group {
        if data.count > 0 {
          Text(verbatim: "\(data.count)")
            .font(.title2.weight(.semibold))
            .foregroundStyle(.orange)
        } else {
          Image(systemName: "checkmark")
            .font(.title3.weight(.semibold))
        }
      }
      .widgetLabel {
        Text(data.text)
      }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text(verbatim: "OpenBot")
          .font(.headline)
          .widgetAccentable()
        Text(data.text)
          .font(.body)
          .foregroundStyle(data.count > 0 ? Color.orange : Color.primary)
          .lineLimit(1)
        if let name = data.name {
          Text(name)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    case .accessoryInline:
      Label(data.text, systemImage: data.count > 0 ? "person.fill" : "checkmark")
    default:
      Text(verbatim: "\(data.count)")
    }
  }
}
