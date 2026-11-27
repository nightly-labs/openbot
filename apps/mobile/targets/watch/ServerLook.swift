import SwiftUI

enum ServerLogoKind: String {
  case squircle, cercle, galet, capsule, carre, losange, triangle, pentagone, hexagone, nuage

  init(_ name: String?) {
    self = name.flatMap(ServerLogoKind.init(rawValue:)) ?? .squircle
  }

  var corners: [CGPoint]? {
    switch self {
    case .losange: return [CGPoint(x: 50, y: 3), CGPoint(x: 97, y: 50), CGPoint(x: 50, y: 97), CGPoint(x: 3, y: 50)]
    case .triangle: return [CGPoint(x: 50, y: 6), CGPoint(x: 96, y: 90), CGPoint(x: 4, y: 90)]
    case .pentagone:
      return [
        CGPoint(x: 50, y: 4), CGPoint(x: 96, y: 38), CGPoint(x: 78, y: 94), CGPoint(x: 22, y: 94), CGPoint(x: 4, y: 38),
      ]
    case .hexagone:
      return [
        CGPoint(x: 50, y: 3), CGPoint(x: 92, y: 27), CGPoint(x: 92, y: 73), CGPoint(x: 50, y: 97), CGPoint(x: 8, y: 73),
        CGPoint(x: 8, y: 27),
      ]
    default: return nil
    }
  }
}

extension WatchServer {
  var logo: ServerLogoKind { ServerLogoKind(shape) }

  func tint(accent: String) -> Color {
    color.flatMap(Color.init(hex:)) ?? Color(hex: accent) ?? .accentColor
  }
}

struct ServerPalette {
  static let defaultBadge = Color.blue

  let title: Color
  let label: Color
  let attention: Color
  let unread: Color
  let working: Color
  let badge: Color
  let onBadge: Color

  init?(tint: Color) {
    var hue: CGFloat = 0
    var saturation: CGFloat = 0
    var brightness: CGFloat = 0
    var alpha: CGFloat = 0
    guard UIColor(tint).getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha),
      saturation >= 0.12
    else { return nil }
    let tone = { (saturation: CGFloat, brightness: CGFloat) in
      Color(hue: hue, saturation: saturation, brightness: brightness)
    }
    title = tone(min(saturation * 0.45, 0.4), 1)
    label = tone(min(saturation * 0.22, 0.18), 0.86)
    attention = tone(min(max(saturation, 0.6), 0.9), 1)
    unread = tone(min(max(saturation, 0.5), 0.85), 0.78)
    working = tone(min(saturation * 0.3, 0.28), 0.96)
    badge = unread
    onBadge = UIColor(unread).luminance > 0.5 ? .black : .white
  }
}

extension UIColor {
  var luminance: CGFloat {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return 0 }
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
}

private struct ServerPaletteKey: EnvironmentKey {
  static let defaultValue: ServerPalette? = nil
}

extension EnvironmentValues {
  var serverPalette: ServerPalette? {
    get { self[ServerPaletteKey.self] }
    set { self[ServerPaletteKey.self] = newValue }
  }
}

struct UnreadBadge: View {
  @Environment(\.serverPalette) private var palette
  let count: Int
  var compact = false

  var body: some View {
    Text(verbatim: count > 99 ? "99+" : String(count))
      .font(compact ? .system(size: 10, weight: .bold) : .caption2.weight(.bold))
      .foregroundStyle(palette?.onBadge ?? .white)
      .padding(.horizontal, compact ? 4 : 6)
      .padding(.vertical, compact ? 0 : 2)
      .frame(minWidth: compact ? 16 : nil, minHeight: compact ? 16 : nil)
      .background(palette?.badge ?? ServerPalette.defaultBadge, in: Capsule())
  }
}

extension UIImage {
  private static let sampleSide = 24
  private static let hueBuckets = 12

  var dominantColor: Color? {
    guard let cgImage else { return nil }
    let side = Self.sampleSide
    var pixels = [UInt8](repeating: 0, count: side * side * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return false }
      context.interpolationQuality = .medium
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))
      return true
    }
    guard drawn else { return nil }
    var weights = [CGFloat](repeating: 0, count: Self.hueBuckets)
    var sums = [(red: CGFloat, green: CGFloat, blue: CGFloat)](
      repeating: (0, 0, 0), count: Self.hueBuckets)
    for offset in stride(from: 0, to: pixels.count, by: 4) {
      let alpha = CGFloat(pixels[offset + 3]) / 255
      guard alpha > 0.6 else { continue }
      let red = CGFloat(pixels[offset]) / 255 / alpha
      let green = CGFloat(pixels[offset + 1]) / 255 / alpha
      let blue = CGFloat(pixels[offset + 2]) / 255 / alpha
      let high = max(red, green, blue)
      let spread = high - min(red, green, blue)
      guard high > 0.15, spread / high > 0.2 else { continue }
      let bucket = Self.hueBucket(red: red, green: green, blue: blue, high: high, spread: spread)
      let weight = spread
      weights[bucket] += weight
      sums[bucket].red += red * weight
      sums[bucket].green += green * weight
      sums[bucket].blue += blue * weight
    }
    guard let best = weights.indices.max(by: { weights[$0] < weights[$1] }), weights[best] > 0 else { return nil }
    let total = weights[best]
    return Color(red: sums[best].red / total, green: sums[best].green / total, blue: sums[best].blue / total)
  }

  private static func hueBucket(red: CGFloat, green: CGFloat, blue: CGFloat, high: CGFloat, spread: CGFloat) -> Int {
    let sector: CGFloat
    if high == red {
      sector = (green - blue) / spread
    } else if high == green {
      sector = (blue - red) / spread + 2
    } else {
      sector = (red - green) / spread + 4
    }
    let turn = (sector / 6).truncatingRemainder(dividingBy: 1)
    let hue = turn < 0 ? turn + 1 : turn
    return min(Int(hue * CGFloat(hueBuckets)), hueBuckets - 1)
  }
}

struct ServerLogoShape: Shape {
  let kind: ServerLogoKind

  func path(in rect: CGRect) -> Path {
    let side = min(rect.width, rect.height)
    let unit = side / 100
    let origin = CGPoint(x: rect.midX - side / 2, y: rect.midY - side / 2)
    let box = { (x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) in
      CGRect(x: origin.x + x * unit, y: origin.y + y * unit, width: width * unit, height: height * unit)
    }
    if let corners = kind.corners {
      return Path { path in
        path.addLines(corners.map { CGPoint(x: origin.x + $0.x * unit, y: origin.y + $0.y * unit) })
        path.closeSubpath()
      }
    }
    switch kind {
    case .cercle:
      return Circle().path(in: box(4, 4, 92, 92))
    case .capsule:
      return Capsule().path(in: box(2, 24, 96, 52))
    case .carre:
      return RoundedRectangle(cornerRadius: 12 * unit, style: .continuous).path(in: box(6, 6, 88, 88))
    case .galet:
      let center = CGPoint(x: origin.x + 50 * unit, y: origin.y + 52 * unit)
      let turn = CGAffineTransform(translationX: center.x, y: center.y)
        .rotated(by: -14 * .pi / 180)
        .translatedBy(x: -center.x, y: -center.y)
      return Path(ellipseIn: box(3, 14, 94, 76)).applying(turn)
    default:
      return RoundedRectangle(cornerRadius: 30 * unit, style: .continuous).path(in: box(4, 4, 92, 92))
    }
  }
}

struct ServerLogo<Fill: ShapeStyle>: View {
  let kind: ServerLogoKind
  let picture: UIImage?
  let fill: Fill
  let side: CGFloat

  var body: some View {
    Group {
      if let picture {
        Image(uiImage: picture)
          .resizable()
          .scaledToFit()
      } else if kind == .nuage {
        Image(systemName: "cloud.fill")
          .resizable()
          .scaledToFit()
          .foregroundStyle(fill)
      } else {
        ServerLogoShape(kind: kind)
          .fill(fill)
          .overlay {
            ServerLogoShape(kind: kind)
              .stroke(fill, style: StrokeStyle(lineWidth: side * 0.06, lineJoin: .round))
          }
      }
    }
    .frame(width: side, height: side)
    .accessibilityHidden(true)
  }
}

struct ServerBadge: View {
  @EnvironmentObject private var session: WatchSession
  let server: WatchServer
  let tint: Color
  var side: CGFloat = 24

  var body: some View {
    ServerLogo(kind: server.logo, picture: session.picture(server), fill: tint, side: side)
      .saturation(server.online ? 1 : 0.35)
      .overlay(alignment: .bottomTrailing) {
        Circle()
          .fill(server.online ? Color.green : Color.secondary)
          .frame(width: 8, height: 8)
          .overlay(Circle().stroke(.black, lineWidth: 1.5))
          .offset(x: 2, y: 2)
      }
      .accessibilityHidden(true)
  }
}

private func logoFill(_ tint: Color) -> LinearGradient {
  LinearGradient(colors: [tint, tint.opacity(0.35)], startPoint: .top, endPoint: .bottom)
}

struct ServerBackdrop: View {
  static let logoShare: CGFloat = 0.78

  @EnvironmentObject private var session: WatchSession
  @Environment(\.isLuminanceReduced) private var dimmed
  let server: WatchServer
  let tint: Color
  var page = 0

  var body: some View {
    GeometryReader { proxy in
      let side = proxy.size.width * Self.logoShare
      ZStack(alignment: .bottomTrailing) {
        LinearGradient(
          colors: [tint.opacity(0.34), .black], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.72))
        ServerLogo(kind: server.logo, picture: session.picture(server), fill: logoFill(tint), side: side)
          .opacity(0.5)
          .offset(x: side * 0.3 - CGFloat(page) * proxy.size.width, y: side * 0.26)
      }
      .frame(width: proxy.size.width, height: proxy.size.height)
      .clipped()
    }
    .background(.black)
    .opacity(dimmed ? 0.4 : 1)
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}

struct ServerRowBackdrop: View {
  static let logoSide: CGFloat = 72

  @EnvironmentObject private var session: WatchSession
  let server: WatchServer
  let tint: Color

  var body: some View {
    LinearGradient(colors: [tint.opacity(0.45), tint.opacity(0.12)], startPoint: .leading, endPoint: .trailing)
      .overlay(alignment: .trailing) {
        ServerLogo(kind: server.logo, picture: session.picture(server), fill: logoFill(tint), side: Self.logoSide)
          .opacity(0.4)
          .offset(x: Self.logoSide * 0.3, y: Self.logoSide * 0.2)
      }
      .background(Color(white: 0.13))
      .saturation(server.online ? 1 : 0.35)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      .accessibilityHidden(true)
  }
}
