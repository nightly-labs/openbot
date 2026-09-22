// These tests use temporary files and a fake directory service. They never create macOS users.
import Darwin
import Foundation
func expectEqual<T: Equatable>(_ actual: T, _ expected: T) {
    guard actual == expected else { fatalError("Values differ") }
}
func expectTrue(_ value: Bool) {
    guard value else { fatalError("Expected true") }
}
func expectNotNil<T>(_ value: T?) {
    guard value != nil else { fatalError("Expected a value") }
}
func expectFailure<T>(_ work: @autoclosure () throws -> T) {
    do { _ = try work() } catch { return }
    fatalError("Expected failure")
}

final class FakeTenantSetup: TenantAccountSetup {
    var events: [String] = []
    var credentials: [TenantCredential] = []
    var conflict = false
    var saveFails = false
    var createFails = false
    func preflight(_ names: [String]) throws -> [UInt32] {
        events.append("preflight")
        if conflict { throw TenantSetupError.conflict }
        return names.indices.map { UInt32(501 + $0) }
    }
    func saveCredentials(_ credentials: [TenantCredential]) throws {
        events.append("save")
        if saveFails { throw TenantSetupError.directoryFailure }
        self.credentials = credentials
    }
    func createAccount(_ credential: TenantCredential) throws {
        events.append("create:\(credential.username)")
        if createFails { throw TenantSetupError.accountFailure }
    }
}

final class TenantSetupTests {
    func testMembershipCheckAcceptsNonmemberAndRejectsMissingUser() throws {
        try requireStandardUser("nobody")
        expectFailure(try requireStandardUser("__openbot_nonexistent_account_test__"))
    }
    func testInvalidOrDuplicateNamesNeverReachAccountOperations() {
        for names in [[], ["root", "root"], ["../other"], ["-admin"], ["a b"], ["name\n"], ["UPPER"], [String(repeating: "a", count: 32)]] {
            let setup = FakeTenantSetup()
            expectFailure(try provisionTenants(names, using: setup))
            expectTrue(setup.events.isEmpty)
        }
    }

    func testConflictStopsWholeBatchBeforeSavingOrCreating() {
        let setup = FakeTenantSetup()
        setup.conflict = true
        expectFailure(try provisionTenants(["client-acme", "client-bravo"], using: setup))
        expectEqual(setup.events, ["preflight"])
    }

    func testPasswordsSavedBeforeAccountsAreCreated() throws {
        let setup = FakeTenantSetup()
        try provisionTenants(["client-acme", "client-bravo"], using: setup)
        expectEqual(setup.events, ["preflight", "save", "create:client-acme", "create:client-bravo"])
        expectEqual(setup.credentials.map(\.uid), [501, 502])
        expectEqual(Set(setup.credentials.map(\.password)).count, 2)
        for credential in setup.credentials {
            expectEqual(credential.password.count, 36)
            expectNotNil(Data(base64Encoded: String(credential.password.dropFirst(4))))
        }
    }

    func testCredentialWriteFailureCreatesNoAccounts() {
        let setup = FakeTenantSetup()
        setup.saveFails = true
        expectFailure(try provisionTenants(["client-acme"], using: setup))
        expectEqual(setup.events, ["preflight", "save"])
    }

    func testPartialFailurePreservesCredentialsAndStopsBatch() {
        let setup = FakeTenantSetup()
        setup.createFails = true
        expectFailure(try provisionTenants(["client-acme", "client-bravo"], using: setup))
        expectEqual(setup.events, ["preflight", "save", "create:client-acme"])
        expectEqual(setup.credentials.count, 2)
    }

    func testCredentialFileIsPrivateAndCannotBeReplaced() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(atPath: path) }
        let directory = try openPrivateSetupDirectory(path, owner: getuid())
        defer { close(directory) }
        let credential = TenantCredential(username: "client-acme", uid: 501, password: "test-secret-only")
        try writeNewCredentialFile([credential], directory: directory, name: "credentials.json")
        let data = try Data(contentsOf: URL(fileURLWithPath: path + "/credentials.json"))
        expectEqual(try JSONDecoder().decode([TenantCredential].self, from: data).first?.password, credential.password)
        var info = stat()
        expectEqual(fstatat(directory, "credentials.json", &info, AT_SYMLINK_NOFOLLOW), 0)
        expectEqual(info.st_mode & 0o777, 0o600)
        expectFailure(try writeNewCredentialFile([], directory: directory, name: "credentials.json"))
        expectEqual(try Data(contentsOf: URL(fileURLWithPath: path + "/credentials.json")), data)
        expectEqual(symlinkat("credentials.json", directory, "link.json"), 0)
        expectFailure(try writeNewCredentialFile([], directory: directory, name: "link.json"))
        expectEqual(try Data(contentsOf: URL(fileURLWithPath: path + "/credentials.json")), data)
    }

    func testDirectorySymlinkAndWritableDirectoryAreRejected() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(atPath: path) }
        expectEqual(symlink(path, path + "/link"), 0)
        expectFailure(try openPrivateSetupDirectory(path + "/link", owner: getuid()))
        expectEqual(chmod(path, 0o777), 0)
        expectFailure(try openPrivateSetupDirectory(path, owner: getuid()))
    }

    func testWritableACLIsRejected() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(atPath: path) }
        let command = Process()
        command.executableURL = URL(fileURLWithPath: "/bin/chmod")
        command.arguments = ["+a", "everyone allow add_file", path]
        try command.run()
        command.waitUntilExit()
        expectEqual(command.terminationStatus, 0)
        expectFailure(try openPrivateSetupDirectory(path, owner: getuid()))
    }
}

@main
enum TenantSetupTestCommand {
    static func main() throws {
        let tests = TenantSetupTests()
        let cases: [(String, () throws -> Void)] = [
            ("native membership check", tests.testMembershipCheckAcceptsNonmemberAndRejectsMissingUser),
            ("invalid names", tests.testInvalidOrDuplicateNamesNeverReachAccountOperations),
            ("preflight conflict", tests.testConflictStopsWholeBatchBeforeSavingOrCreating),
            ("password generation and ordering", tests.testPasswordsSavedBeforeAccountsAreCreated),
            ("credential write failure", tests.testCredentialWriteFailureCreatesNoAccounts),
            ("partial failure", tests.testPartialFailurePreservesCredentialsAndStopsBatch),
            ("private exclusive credentials", tests.testCredentialFileIsPrivateAndCannotBeReplaced),
            ("unsafe directories", tests.testDirectorySymlinkAndWritableDirectoryAreRejected),
            ("writable ACL", tests.testWritableACLIsRejected),
        ]
        for (name, run) in cases {
            FileHandle.standardError.write(Data("RUN: \(name)\n".utf8))
            try run()
            print("PASS: \(name)")
        }
    }
}
