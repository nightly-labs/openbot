// Administrator-only provisioning. This executable is never installed in the Host Manager.
import Darwin
import Foundation
import OpenDirectory
import Security

enum TenantSetupError: Error {
    case invalidNames, conflict, unsafePath, directoryFailure, passwordFailure, accountFailure
}

struct TenantCredential: Codable {
    let username: String
    let uid: UInt32
    let password: String
}

protocol TenantAccountSetup {
    func preflight(_ names: [String]) throws -> [UInt32]
    func saveCredentials(_ credentials: [TenantCredential]) throws
    func createAccount(_ credential: TenantCredential) throws
}

func validateTenantNames(_ names: [String]) throws {
    guard !names.isEmpty, names.count <= 100, Set(names).count == names.count,
          names.allSatisfy({ $0.range(of: "\\A[a-z][a-z0-9_-]{0,30}\\z", options: .regularExpression) != nil })
    else { throw TenantSetupError.invalidNames }
}

func generateTenantPassword() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 24)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess
    else { throw TenantSetupError.passwordFailure }
    // 192 random bits, plus fixed characters to meet common local complexity policies.
    return "Aa1!" + Data(bytes).base64EncodedString()
}

func provisionTenants(_ names: [String], using setup: TenantAccountSetup) throws {
    try validateTenantNames(names)
    let uids = try setup.preflight(names)
    guard uids.count == names.count, Set(uids).count == uids.count, uids.allSatisfy({ $0 >= 501 })
    else { throw TenantSetupError.conflict }
    let credentials = try zip(names, uids).map {
        TenantCredential(username: $0.0, uid: $0.1, password: try generateTenantPassword())
    }
    // Persist first: even a partial failure must not lose the generated credentials.
    try setup.saveCredentials(credentials)
    for credential in credentials { try setup.createAccount(credential) }
}

// Descriptor-based operations never follow an existing tenant home or credential symlink.
func openPrivateSetupDirectory(_ path: String, owner: uid_t) throws -> Int32 {
    let fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw TenantSetupError.unsafePath }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_uid == owner, info.st_mode & 0o022 == 0 else {
        close(fd)
        throw TenantSetupError.unsafePath
    }
    do { try rejectWritableACL(fd) } catch { close(fd); throw error }
    return fd
}

func rejectWritableACL(_ fd: Int32) throws {
    guard let acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED) else {
        // On a valid open descriptor, macOS reports ENOENT when no extended ACL exists.
        if errno == ENOENT { return }
        throw TenantSetupError.unsafePath
    }
    defer { acl_free(UnsafeMutableRawPointer(acl)) }
    var entry: acl_entry_t?
    var cursor = ACL_FIRST_ENTRY
    while acl_get_entry(acl, Int32(cursor.rawValue), &entry) == 0 {
        cursor = ACL_NEXT_ENTRY
        var tag = ACL_UNDEFINED_TAG
        var permissions: acl_permset_t?
        guard acl_get_tag_type(entry, &tag) == 0, acl_get_permset(entry, &permissions) == 0
        else { throw TenantSetupError.unsafePath }
        if tag != ACL_EXTENDED_ALLOW { continue }
        for permission in [ACL_WRITE_DATA, ACL_APPEND_DATA, ACL_DELETE, ACL_DELETE_CHILD,
                           ACL_WRITE_ATTRIBUTES, ACL_WRITE_EXTATTRIBUTES, ACL_WRITE_SECURITY, ACL_CHANGE_OWNER] {
            guard acl_get_perm_np(permissions, permission) == 0 else { throw TenantSetupError.unsafePath }
        }
    }
}

func clearNewFileACL(_ fd: Int32) throws {
    guard let acl = acl_init(0) else { throw TenantSetupError.unsafePath }
    defer { acl_free(UnsafeMutableRawPointer(acl)) }
    guard acl_set_fd_np(fd, acl, ACL_TYPE_EXTENDED) == 0 else { throw TenantSetupError.unsafePath }
}

func writeNewCredentialFile(_ credentials: [TenantCredential], directory: Int32, name: String) throws {
    let fd = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { throw TenantSetupError.unsafePath }
    defer { close(fd) }
    try clearNewFileACL(fd)
    guard fchmod(fd, 0o600) == 0 else { throw TenantSetupError.unsafePath }
    let data = try JSONEncoder().encode(credentials)
    try data.withUnsafeBytes { buffer in
        var offset = 0
        while offset < buffer.count {
            let count = write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw TenantSetupError.directoryFailure }
            offset += count
        }
    }
    guard fsync(fd) == 0, fcntl(fd, F_FULLFSYNC) == 0, fsync(directory) == 0
    else { throw TenantSetupError.directoryFailure }
}

final class MacTenantAccountSetup: TenantAccountSetup {
    private let node: ODNode
    private let search: ODNode
    private let users: Int32
    private let secrets: Int32
    private let lock: Int32
    let credentialFilename = "openbot-tenant-credentials-\(UUID().uuidString).json"

    init() throws {
        // All ancestors are fixed system directories, never supplied by a tenant.
        for path in ["/", "/private", "/private/var", "/private/var/run"] {
            let fd = try openPrivateSetupDirectory(path, owner: 0)
            close(fd)
        }
        lock = open("/private/var/run/openbot-tenant-setup.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        var info = stat()
        guard lock >= 0, fstat(lock, &info) == 0, info.st_uid == 0,
              info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o077 == 0, info.st_nlink == 1,
              flock(lock, LOCK_EX | LOCK_NB) == 0 else { throw TenantSetupError.unsafePath }
        users = try openPrivateSetupDirectory("/Users", owner: 0)
        secrets = try openPrivateSetupDirectory("/private/var/root", owner: 0)
        node = try ODNode(session: ODSession.default(), name: "/Local/Default")
        search = try ODNode(session: ODSession.default(), type: ODNodeType(kODNodeTypeAuthentication))
    }

    deinit { close(users); close(secrets); close(lock) }

    private func records(type: String, attribute: String, value: String) throws -> [ODRecord] {
        let query = try ODQuery(node: search, forRecordTypes: type, attribute: attribute,
                                matchType: ODMatchType(kODMatchEqualTo), queryValues: value,
                                returnAttributes: [kODAttributeTypeRecordName], maximumResults: 1)
        guard let records = try query.resultsAllowingPartial(false) as? [ODRecord]
        else { throw TenantSetupError.directoryFailure }
        return records
    }

    private func requireUnusedName(_ name: String) throws {
        guard try records(type: kODRecordTypeUsers, attribute: kODAttributeTypeRecordName, value: name).isEmpty,
              try records(type: kODRecordTypeGroups, attribute: kODAttributeTypeGroupMembership, value: name).isEmpty
        else { throw TenantSetupError.conflict }
        var info = stat()
        guard fstatat(users, name, &info, AT_SYMLINK_NOFOLLOW) != 0, errno == ENOENT
        else { throw TenantSetupError.conflict }
    }

    func preflight(_ names: [String]) throws -> [UInt32] {
        for name in names { try requireUnusedName(name) }
        var candidate: UInt32 = 501
        var uids: [UInt32] = []
        for _ in names {
            while candidate < 60_000 {
                if try records(type: kODRecordTypeUsers, attribute: kODAttributeTypeUniqueID,
                               value: String(candidate)).isEmpty { break }
                candidate += 1
            }
            guard candidate < 60_000 else { throw TenantSetupError.conflict }
            uids.append(candidate)
            candidate += 1
        }
        return uids
    }

    func saveCredentials(_ credentials: [TenantCredential]) throws {
        try writeNewCredentialFile(credentials, directory: secrets, name: credentialFilename)
        print("Credentials saved in /private/var/root/\(credentialFilename)")
    }

    func createAccount(_ credential: TenantCredential) throws {
        try requireUnusedName(credential.username)
        guard try records(type: kODRecordTypeUsers, attribute: kODAttributeTypeUniqueID,
                          value: String(credential.uid)).isEmpty else { throw TenantSetupError.conflict }
        // mkdirat is exclusive. Existing homes are never opened, repaired, scanned or removed.
        guard mkdirat(users, credential.username, 0o700) == 0 else { throw TenantSetupError.conflict }
        let home = openat(users, credential.username, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard home >= 0 else { throw TenantSetupError.unsafePath }
        defer { close(home) }
        // Clear inherited ACLs only on the empty directory created by this invocation.
        try clearNewFileACL(home)
        guard fchmod(home, 0o700) == 0, fchown(home, credential.uid, 20) == 0
        else { throw TenantSetupError.unsafePath }
        let record = try node.createRecord(withRecordType: kODRecordTypeUsers, name: credential.username,
            attributes: [
                kODAttributeTypeUniqueID: [String(credential.uid)],
                kODAttributeTypePrimaryGroupID: ["20"],
                kODAttributeTypeNFSHomeDirectory: ["/Users/\(credential.username)"],
                kODAttributeTypeUserShell: ["/bin/zsh"],
                kODAttributeTypeFullName: [credential.username],
                kODAttributeTypePassword: ["*"],
            ])
        try record.synchronize()
        try requireStandardUser(credential.username)
        // OpenDirectory receives the secret in memory, never through argv, env or a subprocess.
        try record.changePassword(nil, toPassword: credential.password)
        try record.synchronize()
        try record.verifyPassword(credential.password)
        try requireStandardUser(credential.username)
        print("Created Standard user: \(credential.username)")
    }
}

func requireStandardUser(_ name: String) throws {
    let command = Process()
    command.executableURL = URL(fileURLWithPath: "/usr/sbin/dseditgroup")
    command.arguments = ["-o", "checkmember", "-m", name, "admin"]
    command.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"]
    let output = Pipe()
    command.standardOutput = output
    command.standardError = FileHandle.nullDevice
    try command.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    command.waitUntilExit()
    // dseditgroup uses EX_NOUSER (67) for an existing user that is not a group member.
    guard command.terminationReason == .exit, command.terminationStatus == 67,
          String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            == "no \(name) is NOT a member of admin"
    else { throw TenantSetupError.accountFailure }
}

#if !TENANT_SETUP_TESTS
@main
enum TenantSetupCommand {
    static func main() {
        let names = Array(CommandLine.arguments.dropFirst())
        if names == ["--help"] {
            print("Usage: sudo openbot-create-tenants <new-standard-user>...")
            return
        }
        guard getuid() == 0, geteuid() == 0 else {
            fputs("Account creation requires an administrator running this command with sudo.\n", stderr)
            exit(1)
        }
        do {
            try validateTenantNames(names)
            let setup = try MacTenantAccountSetup()
            try provisionTenants(names, using: setup)
            print("Account setup complete. Log each user into a GUI session, then enroll them with the host installer.")
        } catch {
            // Directory-service errors can contain credential data. Never print the raw error.
            fputs("Account setup stopped. Existing accounts are not reset. If a credential file was saved, keep it and inspect the partial setup as administrator before retrying.\n", stderr)
            exit(1)
        }
    }
}
#endif
