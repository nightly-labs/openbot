import SwiftUI

extension WatchQuestionWait {
  var single: WatchQuestion? {
    guard questions.count == 1, let question = questions.first, !question.multiSelect else { return nil }
    return question
  }
}

struct QuestionHeading: View {
  @Environment(\.watchText) private var text
  let wait: WatchQuestionWait
  let index: Int

  var body: some View {
    let question = wait.questions[index]
    VStack(alignment: .leading, spacing: 2) {
      if wait.questions.count > 1 {
        Text(text(TextKey.position, ["current": String(index + 1), "total": String(wait.questions.count)]))
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      if !question.header.isEmpty && question.header != question.question {
        Text(question.header)
          .font(.footnote.weight(.semibold))
          .privacySensitive()
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct QuestionPageContent: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  let wait: WatchQuestionWait
  @Binding var path: [WatchRoute]
  var full = false

  var body: some View {
    if let first = wait.questions.first {
      VStack(spacing: 6) {
        QuestionHeading(wait: wait, index: 0)
        if full {
          TextCard(text: first.question, lines: nil)
        } else {
          TextCard(text: first.question, lines: 4) {
            path.append(.detail(agent.key))
          }
        }
        VStack(spacing: 6) {
          if let single = wait.single {
            ForEach(single.options, id: \.self) { option in
              Button {
                Task { await answer([single.id: [option]]) }
              } label: {
                Text(option)
                  .font(.footnote)
                  .lineLimit(2)
                  .frame(maxWidth: .infinity)
              }
              .armed(for: wait.requestId)
            }
            DictateLink(
              target: .answer(agent.key, requestId: wait.requestId, questionId: single.id),
              path: $path
            ) {
              ActionLabel(title: text(TextKey.dictate), symbol: "mic.fill")
            }
          } else {
            Button {
              path.append(.questions(agent.key))
            } label: {
              ActionLabel(title: text(TextKey.answer), symbol: "checklist")
            }
          }
          if full {
            OpenOnPhoneButton(agent: agent)
          }
        }
        .disabled(!session.canAct)
      }
    }
  }

  private func answer(_ answers: [String: [String]]) async {
    await session.perform(
      .answer(serverId: agent.serverId, agentId: agent.id, requestId: wait.requestId, answers: answers),
      done: text(TextKey.doneAnswered))
  }
}

struct QuestionFlowView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  @Binding var path: [WatchRoute]
  @State private var index = 0
  @State private var answers: [String: [String]] = [:]
  @State private var checked: Set<String> = []

  var body: some View {
    if case .question(let wait) = agent.wait, !wait.questions.isEmpty {
      Group {
        if index < wait.questions.count {
          step(wait: wait, question: wait.questions[index])
        } else {
          summary(wait: wait)
        }
      }
      .navigationTitle(agent.name)
      .onChange(of: wait.requestId) { _, _ in
        index = 0
        answers = [:]
        checked = []
      }
    }
  }

  private func step(wait: WatchQuestionWait, question: WatchQuestion) -> some View {
    List {
      Section {
        ForEach(question.options, id: \.self) { option in
          Button {
            choose(option, in: question, wait: wait)
          } label: {
            HStack {
              Text(option)
                .font(.footnote)
              Spacer(minLength: 4)
              if question.multiSelect {
                Image(systemName: checked.contains(option) ? "checkmark.circle.fill" : "circle")
                  .foregroundStyle(checked.contains(option) ? Color.blue : .secondary)
              }
            }
          }
          .accessibilityAddTraits(checked.contains(option) ? .isSelected : [])
          .armed(for: "\(wait.requestId)/\(question.id)")
        }
        TextFieldLink {
          ActionLabel(title: text(TextKey.dictate), symbol: "mic.fill")
        } onSubmit: { value in
          let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
          if !trimmed.isEmpty { record([trimmed], for: question, wait: wait) }
        }
        if question.multiSelect {
          Button {
            record(question.options.filter { checked.contains($0) }, for: question, wait: wait)
          } label: {
            ActionLabel(title: text(TextKey.next), symbol: "arrow.right")
          }
          .disabled(checked.isEmpty)
        }
      } header: {
        VStack(alignment: .leading, spacing: 4) {
          QuestionHeading(wait: wait, index: index)
          Text(question.question)
            .font(.footnote)
            .foregroundStyle(.primary)
            .privacySensitive()
        }
        .textCase(nil)
      }
    }
    .disabled(!session.canAct)
  }

  private func summary(wait: WatchQuestionWait) -> some View {
    List {
      ForEach(wait.questions) { question in
        VStack(alignment: .leading, spacing: 2) {
          Text(question.header.isEmpty ? question.question : question.header)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(2)
          Text((answers[question.id] ?? []).joined(separator: ", "))
            .font(.footnote)
            .privacySensitive()
        }
      }
      Button {
        Task { await send(wait: wait) }
      } label: {
        ActionLabel(title: text(TextKey.send), symbol: "paperplane.fill")
      }
      .tint(Color(hex: agent.color) ?? .blue)
      .disabled(!session.canAct)
      .primaryActionShortcut()
      Button {
        index = 0
        answers = [:]
        checked = []
      } label: {
        ActionLabel(title: text(TextKey.again), symbol: "arrow.counterclockwise")
      }
    }
  }

  private func choose(_ option: String, in question: WatchQuestion, wait: WatchQuestionWait) {
    guard question.multiSelect else {
      record([option], for: question, wait: wait)
      return
    }
    if checked.contains(option) { checked.remove(option) } else { checked.insert(option) }
  }

  private func record(_ values: [String], for question: WatchQuestion, wait: WatchQuestionWait) {
    answers[question.id] = values
    checked = []
    index += 1
  }

  private func send(wait: WatchQuestionWait) async {
    let done = await session.perform(
      .answer(serverId: agent.serverId, agentId: agent.id, requestId: wait.requestId, answers: answers),
      done: text(TextKey.doneAnswered))
    if done { path = [] }
  }
}
