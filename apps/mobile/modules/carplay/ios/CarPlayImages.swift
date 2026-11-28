import UIKit

@MainActor
enum CarPlayImages {
  private static let voiceSymbolSize: CGFloat = 72
  private static let speakingLevels: [Double] = [0.2, 0.45, 0.75, 1, 0.7, 0.4]
  private static let speakingCycle: TimeInterval = 0.9
  private static let unreadDotSize: CGFloat = 12
  private static let voiceAvatarCycle: TimeInterval = 5
  private static let voiceSide: CGFloat = 150
  private static let voiceMaxScale: CGFloat = 2
  private static let voiceButtonSize: CGFloat = 24
  private static let voiceCaptionSize: CGFloat = 16

  static func avatar(_ agent: CarPlayAgent, size: CGSize, scale: CGFloat) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    let bounds = CGRect(origin: .zero, size: size)
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      UIBezierPath(ovalIn: bounds).addClip()
      if let picture = picture(of: agent) {
        picture.draw(in: aspectFill(picture.size, in: bounds))
        return
      }
      UIColor.systemGray.setFill()
      UIRectFill(bounds)
      let initial = String(agent.name.prefix(1)).uppercased()
      let font = UIFont.systemFont(ofSize: size.height * 0.45, weight: .semibold)
      let text = NSAttributedString(string: initial, attributes: [.font: font, .foregroundColor: UIColor.white])
      let measured = text.size()
      text.draw(at: CGPoint(x: (size.width - measured.width) / 2, y: (size.height - measured.height) / 2))
    }
  }

  static func pictureMissing(_ agent: CarPlayAgent) -> Bool {
    guard let path = path(of: agent) else { return false }
    return !FileManager.default.fileExists(atPath: path)
  }

  static func unreadDot(scale: CGFloat) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    let size = CGSize(width: unreadDotSize, height: unreadDotSize)
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      UIColor.systemBlue.setFill()
      UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
    }
  }

  static func voice(
    _ state: CarPlayVoiceState,
    frames: [String],
    caption: String,
    traits: UITraitCollection
  ) -> UIImage? {
    let pictures = frames.compactMap(voicePicture)
    let faces = pictures.isEmpty ? voiceSymbol(state).map { [$0] } ?? [] : pictures
    let captioned = faces.map { voiceFrame($0, caption: caption, traits: traits) }
    if captioned.count > 1 { return UIImage.animatedImage(with: captioned, duration: voiceAvatarCycle) }
    return captioned.first
  }

  static func voiceButton(_ symbol: String) -> UIImage {
    let configuration = UIImage.SymbolConfiguration(pointSize: voiceButtonSize, weight: .semibold)
    return UIImage(systemName: symbol, withConfiguration: configuration) ?? UIImage()
  }

  private static func voiceFrame(_ face: UIImage, caption: String, traits: UITraitCollection) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = min(max(traits.displayScale, 1), voiceMaxScale)
    let size = CGSize(width: voiceSide, height: voiceSide)
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    style.lineBreakMode = .byTruncatingTail
    let text = NSAttributedString(string: caption, attributes: [
      .font: UIFont.systemFont(ofSize: voiceCaptionSize, weight: .semibold),
      .foregroundColor: traits.userInterfaceStyle == .light ? UIColor.black : UIColor.white,
      .paragraphStyle: style,
    ])
    let captionHeight = ceil(text.size().height)
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      let faceSide = voiceSide - captionHeight
      face.draw(in: aspectFit(face.size, in: CGRect(x: (voiceSide - faceSide) / 2, y: 0, width: faceSide, height: faceSide)))
      text.draw(in: CGRect(x: 0, y: voiceSide - captionHeight, width: voiceSide, height: captionHeight))
    }
  }

  private static func aspectFit(_ image: CGSize, in bounds: CGRect) -> CGRect {
    guard image.width > 0, image.height > 0 else { return bounds }
    let ratio = min(bounds.width / image.width, bounds.height / image.height)
    let size = CGSize(width: image.width * ratio, height: image.height * ratio)
    return CGRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width, height: size.height)
  }

  static func voiceRepeats(_ state: CarPlayVoiceState, frames: [String]) -> Bool {
    frames.isEmpty ? state == .speaking : frames.count > 1
  }

  private static func voicePicture(_ uri: String) -> UIImage? {
    let path = URL(string: uri).flatMap { $0.isFileURL ? $0.path : nil } ?? uri
    return UIImage(contentsOfFile: path)
  }

  private static func voiceSymbol(_ state: CarPlayVoiceState) -> UIImage? {
    switch state {
    case .listening: return symbol("mic.fill")
    case .muted: return symbol("mic.slash.fill")
    case .thinking: return symbol("ellipsis")
    case .offline: return symbol("wifi.slash")
    case .unavailable: return symbol("mic.slash")
    case .speaking:
      let frames = speakingLevels.compactMap { symbol("waveform", variableValue: $0) }
      return UIImage.animatedImage(with: frames, duration: speakingCycle)
    }
  }

  private static func symbol(_ name: String, variableValue: Double? = nil) -> UIImage? {
    let configuration = UIImage.SymbolConfiguration(pointSize: voiceSymbolSize, weight: .semibold)
    let image = variableValue.map { UIImage(systemName: name, variableValue: $0, configuration: configuration) }
      ?? UIImage(systemName: name, withConfiguration: configuration)
    return image?.withTintColor(.white, renderingMode: .alwaysOriginal)
  }

  private static func path(of agent: CarPlayAgent) -> String? {
    guard let picture = agent.picture, !picture.isEmpty else { return nil }
    if let url = URL(string: picture), url.isFileURL { return url.path }
    return picture
  }

  private static func picture(of agent: CarPlayAgent) -> UIImage? {
    path(of: agent).flatMap { UIImage(contentsOfFile: $0) }
  }

  private static func aspectFill(_ image: CGSize, in bounds: CGRect) -> CGRect {
    guard image.width > 0, image.height > 0 else { return bounds }
    let ratio = max(bounds.width / image.width, bounds.height / image.height)
    let size = CGSize(width: image.width * ratio, height: image.height * ratio)
    return CGRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width, height: size.height)
  }
}
