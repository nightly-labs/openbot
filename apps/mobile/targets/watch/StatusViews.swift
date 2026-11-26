import SwiftUI

struct FirstRunView: View {
  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "iphone")
        .font(.system(size: 36))
        .foregroundStyle(.tint)
        .accessibilityHidden(true)
      Text(verbatim: "OpenBot")
        .font(.headline)
    }
  }
}

struct OfflineView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Image(systemName: "iphone.slash")
          .font(.system(size: 30))
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
        Text(text(TextKey.offlineTitle))
          .font(.headline)
          .multilineTextAlignment(.center)
        Text(text(session.phoneNeedsUnlock ? TextKey.offlineUnlock : TextKey.offlineDetail))
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        Button(text(TextKey.retry)) {
          Task { await session.refresh() }
        }
        .disabled(!session.connected)
      }
    }
  }
}

struct LockedView: View {
  @Environment(\.watchText) private var text

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Image(systemName: "lock.fill")
          .font(.system(size: 30))
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
        Text(text(TextKey.lockedTitle))
          .font(.headline)
          .multilineTextAlignment(.center)
        Text(text(TextKey.lockedDetail))
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
    }
  }
}

struct ConnectionNote: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text

  var body: some View {
    if session.serversOffline {
      VStack(alignment: .leading, spacing: 2) {
        Label(text(TextKey.disconnectedTitle), systemImage: "bolt.horizontal.circle")
          .font(.footnote.weight(.semibold))
        Text(text(TextKey.disconnectedDetail))
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(8)
      .background(.orange.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
    } else if session.showsAge, let updatedAt = session.updatedAt {
      VStack(alignment: .leading, spacing: 2) {
        Label(ageText(updatedAt), systemImage: session.connected ? "clock" : "iphone.slash")
          .foregroundStyle(.secondary)
        if session.connected, let error = session.refreshError {
          Text(error)
            .foregroundStyle(.orange)
        }
      }
      .font(.caption2)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func ageText(_ date: Date) -> String {
    let locale = Locale(identifier: session.language)
    let time =
      Calendar.current.isDateInToday(date)
      ? date.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(locale))
      : date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(locale))
    let updated = text(TextKey.updated, ["time": time])
    return session.connected ? updated : "\(text(TextKey.offlineTitle)) · \(updated)"
  }
}

struct EmptyAgentsView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let live: Bool

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        if session.showsConnectionNote {
          ConnectionNote()
        }
        Image(systemName: "person.2")
          .font(.system(size: 28))
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
        Text(text(TextKey.empty))
          .font(.footnote)
          .multilineTextAlignment(.center)
      }
    }
  }
}

struct FeedbackView: View {
  let feedback: WatchFeedback

  var body: some View {
    Label(feedback.text, systemImage: feedback.success ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
      .font(.footnote.weight(.semibold))
      .foregroundStyle(feedback.success ? .green : .orange)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity)
      .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
      .padding(.horizontal, 4)
      .accessibilityAddTraits(.isStaticText)
  }
}

struct AgentAvatar: View {
  @EnvironmentObject private var session: WatchSession
  let agent: WatchAgent
  var size: CGFloat = 44

  var body: some View {
    Group {
      if let image = session.picture(agent) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        ZStack {
          Circle().fill(Color(hex: agent.color) ?? .accentColor)
          Text(String(agent.name.prefix(1)).uppercased())
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(.white)
        }
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .accessibilityHidden(true)
  }
}
