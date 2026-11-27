package run.openbot.remoteviewerproxy

import android.util.Base64
import android.view.WindowManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private const val MAX_HEAD_BYTES = 32 * 1024
private const val MAX_BODY_BYTES = 2 * 1024 * 1024
private const val MAX_MESSAGE_BYTES = 1024 * 1024

/** Another app on the phone can also connect to the loopback port. These limits keep it small. */
private const val MAX_PEERS = 128
private const val READ_TIMEOUT_MS = 30_000
private const val RESPONSE_TIMEOUT_MS = 60_000L
private const val CLOSE_TIMEOUT_MS = 2_000L
private const val WEB_SOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
private val TOKEN = Regex("^[A-Za-z0-9]{16,64}$")
private val METHODS = setOf("GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS")
private val OWNED_HEADERS = setOf("content-length", "transfer-encoding", "connection")
private const val TOKEN_SYMBOLS = "!#$%&'*+-.^_`|~"

class InvalidTokenException : CodedException("The remote viewer token is not valid")

/** A request that the server answers itself, with no event. */
private class HttpFailure(val status: Int, val headers: Map<String, String> = emptyMap()) : Exception()

/** Runs the tasks one after the other on a shared pool, so the writes to one socket keep their order. */
private class SerialExecutor(private val pool: ExecutorService) {
  private val tasks = ArrayDeque<() -> Unit>()
  private var active = false

  fun execute(task: () -> Unit) {
    synchronized(this) {
      tasks.addLast(task)
      if (active) return
      active = true
    }
    try {
      pool.execute { drain() }
    } catch (error: RejectedExecutionException) {
      synchronized(this) {
        tasks.clear()
        active = false
      }
    }
  }

  private fun drain() {
    while (true) {
      val task =
        synchronized(this) {
          tasks.removeFirstOrNull() ?: run {
            active = false
            null
          }
        } ?: return
      task()
    }
  }
}

private class Peer(val socket: Socket, pool: ExecutorService) {
  val input: InputStream = BufferedInputStream(socket.getInputStream(), 64 * 1024)
  private val output: OutputStream = socket.getOutputStream()
  private val writer = SerialExecutor(pool)
  val closed = AtomicBoolean(false)

  /** True after the server sent or answered a close frame. */
  val closing = AtomicBoolean(false)

  @Volatile var received = false

  @Volatile var requestId: String? = null

  @Volatile var socketId: String? = null

  /** Writes in order on a pool thread, so a page that does not read cannot stop the caller. */
  fun write(bytes: ByteArray, done: (Boolean) -> Unit) {
    writer.execute {
      val ok =
        try {
          output.write(bytes)
          output.flush()
          true
        } catch (error: IOException) {
          false
        }
      done(ok)
    }
  }
}

private class Pending(val peer: Peer, val head: Boolean, val timeout: ScheduledFuture<*>?)

private class Request(val method: String, val target: String, val headers: Map<String, String>)

/**
 * A loopback HTTP/1.1 and WebSocket server. It only reads the framing. JavaScript answers each request
 * and each socket message. Each connection has its own reading thread.
 */
internal class RemoteViewerServer(private val emit: (String, Map<String, Any?>) -> Unit) {
  private val pool =
    Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "openbot-remote-viewer").apply { isDaemon = true }
    }
  private val timers =
    Executors.newSingleThreadScheduledExecutor { runnable ->
      Thread(runnable, "openbot-remote-viewer-timer").apply { isDaemon = true }
    }
  private val lock = Any()

  @Volatile private var serverSocket: ServerSocket? = null

  @Volatile private var token = ""
  private val peers = ConcurrentHashMap.newKeySet<Peer>()
  private val pending = ConcurrentHashMap<String, Pending>()
  private val sockets = ConcurrentHashMap<String, Peer>()

  fun start(token: String): Int {
    synchronized(lock) {
      stop()
      if (!TOKEN.matches(token)) throw InvalidTokenException()
      val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
      this.token = token
      serverSocket = server
      try {
        pool.execute { acceptLoop(server, token) }
      } catch (error: RejectedExecutionException) {
        stop()
        throw error
      }
      return server.localPort
    }
  }

  fun stop() {
    synchronized(lock) {
      val server = serverSocket
      serverSocket = null
      token = ""
      closeQuietly(server)
    }
    for (peer in peers.toList()) {
      if (peer.socketId != null && !peer.closing.get()) {
        closeSocket(peer, 1001, "", wait = false)
      } else {
        drop(peer)
      }
    }
  }

  /** Stops the server, closes every connection at once, and ends the threads. */
  fun destroy() {
    stop()
    for (peer in peers.toList()) drop(peer)
    timers.shutdownNow()
    pool.shutdownNow()
  }

  fun respond(requestId: String, status: Int, headers: Map<String, String>, bodyBase64: String) {
    val request = pending.remove(requestId) ?: return
    request.timeout?.cancel(false)
    val body =
      try {
        Base64.decode(bodyBase64, Base64.DEFAULT)
      } catch (error: IllegalArgumentException) {
        writeResponse(request.peer, 502, emptyMap(), ByteArray(0), request.head)
        return
      }
    writeResponse(request.peer, status, headers, body, request.head)
  }

  fun socketSend(socketId: String, text: String?, binaryBase64: String?) {
    val peer = sockets[socketId] ?: return
    if (peer.closing.get()) return
    if (text != null) {
      sendFrame(peer, 0x1, text.toByteArray(Charsets.UTF_8))
    } else if (binaryBase64 != null) {
      val bytes =
        try {
          Base64.decode(binaryBase64, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
          return
        }
      sendFrame(peer, 0x2, bytes)
    }
  }

  fun socketClose(socketId: String, code: Int, reason: String) {
    val peer = sockets[socketId] ?: return
    closeSocket(peer, sendableCloseCode(code), truncated(reason, 123))
  }

  // Connections

  private fun acceptLoop(server: ServerSocket, token: String) {
    while (true) {
      val client =
        try {
          server.accept()
        } catch (error: IOException) {
          return
        }
      if (!client.inetAddress.isLoopbackAddress || peers.size >= MAX_PEERS) {
        closeQuietly(client)
        continue
      }
      val peer =
        try {
          Peer(client, pool)
        } catch (error: IOException) {
          closeQuietly(client)
          continue
        }
      peers.add(peer)
      // A stop can come between the accept and the add.
      if (serverSocket !== server) {
        drop(peer)
        return
      }
      try {
        pool.execute { serve(peer, token) }
      } catch (error: RejectedExecutionException) {
        drop(peer)
        return
      }
    }
  }

  private fun serve(peer: Peer, token: String) {
    try {
      peer.socket.soTimeout = READ_TIMEOUT_MS
      val request = readRequest(peer, token)
      if (request.headers["upgrade"]?.split(',')?.any { it.trim().equals("websocket", ignoreCase = true) } == true) {
        upgrade(peer, request)
      } else {
        val body = readBody(peer, request.headers["content-length"])
        emitRequest(peer, request, body)
      }
    } catch (failure: HttpFailure) {
      reject(peer, failure.status, failure.headers)
    } catch (error: SocketTimeoutException) {
      // A browser can open a spare connection and send nothing on it.
      if (peer.received) reject(peer, 408) else drop(peer)
    } catch (error: Exception) {
      drop(peer)
    }
  }

  /** Ends the connection. A WebSocket that did not report its close yet reports 1006. */
  private fun drop(peer: Peer) {
    if (!peer.closed.compareAndSet(false, true)) return
    peers.remove(peer)
    peer.requestId?.let { id -> pending.remove(id)?.timeout?.cancel(false) }
    report(peer, 1006, "")
    try {
      peer.socket.shutdownOutput()
    } catch (error: IOException) {
      // The socket is already closed.
    }
    closeQuietly(peer.socket)
  }

  private fun schedule(delayMs: Long, task: () -> Unit): ScheduledFuture<*>? =
    try {
      timers.schedule(Runnable { task() }, delayMs, TimeUnit.MILLISECONDS)
    } catch (error: RejectedExecutionException) {
      null
    }

  // HTTP

  private fun readRequest(peer: Peer, token: String): Request {
    val head = readHead(peer)
    val lines = head.split("\r\n")
    val requestLine = lines.first().split(' ')
    if (requestLine.size != 3 || (requestLine[2] != "HTTP/1.1" && requestLine[2] != "HTTP/1.0")) {
      throw HttpFailure(400)
    }
    val headers = LinkedHashMap<String, String>()
    for (line in lines.drop(1)) {
      val colon = line.indexOf(':')
      if (colon <= 0) throw HttpFailure(400)
      val name = line.substring(0, colon)
      if (!isToken(name)) throw HttpFailure(400)
      val value = line.substring(colon + 1).trim(' ', '\t')
      val key = name.lowercase()
      headers[key] = headers[key]?.let { "$it, $value" } ?: value
    }
    val request = Request(requestLine[0], requestLine[1], headers)
    if (token.isEmpty() || !request.target.startsWith("/$token/")) throw HttpFailure(404)
    if (request.method !in METHODS) throw HttpFailure(405)
    if (headers.containsKey("transfer-encoding")) throw HttpFailure(411)
    return request
  }

  private fun readHead(peer: Peer): String {
    val bytes = ByteArrayOutputStream()
    var matched = 0
    while (matched < 4) {
      val byte = peer.input.read()
      if (byte < 0) throw EOFException()
      peer.received = true
      if (bytes.size() >= MAX_HEAD_BYTES) throw HttpFailure(431)
      bytes.write(byte)
      matched =
        when {
          byte == '\r'.code && (matched == 0 || matched == 2) -> matched + 1
          byte == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
          byte == '\r'.code -> 1
          else -> 0
        }
    }
    return String(bytes.toByteArray(), 0, bytes.size() - 4, Charsets.ISO_8859_1)
  }

  private fun readBody(peer: Peer, contentLength: String?): ByteArray {
    if (contentLength == null) return ByteArray(0)
    if (contentLength.isEmpty() || contentLength.length > 9 || !contentLength.all { it in '0'..'9' }) {
      throw HttpFailure(400)
    }
    val length = contentLength.toInt()
    if (length > MAX_BODY_BYTES) throw HttpFailure(413)
    return readExactly(peer.input, length)
  }

  private fun emitRequest(peer: Peer, request: Request, body: ByteArray) {
    peer.socket.soTimeout = 0
    val requestId = UUID.randomUUID().toString()
    peer.requestId = requestId
    val timeout =
      schedule(RESPONSE_TIMEOUT_MS) {
        val expired = pending.remove(requestId) ?: return@schedule
        writeResponse(expired.peer, 504, emptyMap(), ByteArray(0), expired.head)
      }
    pending[requestId] = Pending(peer, request.method == "HEAD", timeout)
    // A stop can come while the request is read.
    if (peer.closed.get()) {
      pending.remove(requestId)
      timeout?.cancel(false)
      return
    }
    emit(
      "onRequest",
      mapOf(
        "requestId" to requestId,
        "method" to request.method,
        "target" to request.target,
        "headers" to request.headers,
        "bodyBase64" to Base64.encodeToString(body, Base64.NO_WRAP),
      ),
    )
  }

  private fun reject(peer: Peer, status: Int, headers: Map<String, String> = emptyMap()) {
    writeResponse(peer, status, headers, ByteArray(0), false)
  }

  /** Sends one response and closes the connection. */
  private fun writeResponse(peer: Peer, status: Int, headers: Map<String, String>, body: ByteArray, head: Boolean) {
    if (peer.closed.get()) return
    val code = if (status in 200..599) status else 502
    val lines = mutableListOf("HTTP/1.1 $code ${reasonPhrase(code)}")
    var cacheControl = false
    for ((name, value) in headers.toSortedMap()) {
      val key = name.lowercase()
      if (key in OWNED_HEADERS || !isToken(name) || value.any { it == '\r' || it == '\n' || it == '\u0000' }) continue
      if (key == "cache-control") cacheControl = true
      lines.add("$name: $value")
    }
    if (!cacheControl) lines.add("Cache-Control: no-store")
    val bodyless = code == 204 || code == 304
    if (!bodyless) lines.add("Content-Length: ${body.size}")
    lines.add("Connection: close")
    val headBytes = (lines.joinToString("\r\n") + "\r\n\r\n").toByteArray(Charsets.UTF_8)
    val bytes = if (head || bodyless) headBytes else headBytes + body
    peer.write(bytes) { drop(peer) }
  }

  // WebSocket

  private fun upgrade(peer: Peer, request: Request) {
    val key = request.headers["sec-websocket-key"]
    val decodedKey =
      try {
        key?.let { Base64.decode(it, Base64.DEFAULT) }
      } catch (error: IllegalArgumentException) {
        null
      }
    if (request.method != "GET" || key == null || decodedKey?.size != 16) throw HttpFailure(400)
    if (request.headers["sec-websocket-version"] != "13") {
      throw HttpFailure(426, mapOf("Sec-WebSocket-Version" to "13"))
    }
    val digest = MessageDigest.getInstance("SHA-1").digest((key + WEB_SOCKET_GUID).toByteArray(Charsets.UTF_8))
    val lines =
      mutableListOf(
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Accept: ${Base64.encodeToString(digest, Base64.NO_WRAP)}",
      )
    val protocol = request.headers["sec-websocket-protocol"]?.split(',')?.first()?.trim()
    if (protocol != null && isToken(protocol)) lines.add("Sec-WebSocket-Protocol: $protocol")
    peer.socket.soTimeout = 0
    val written = CountDownLatch(1)
    var ok = false
    peer.write((lines.joinToString("\r\n") + "\r\n\r\n").toByteArray(Charsets.UTF_8)) { success ->
      ok = success
      written.countDown()
    }
    written.await()
    if (!ok) return drop(peer)
    val socketId = UUID.randomUUID().toString()
    peer.socketId = socketId
    sockets[socketId] = peer
    // A stop can come while the 101 is written.
    if (peer.closed.get()) {
      sockets.remove(socketId)
      return
    }
    emit("onSocketOpen", mapOf("socketId" to socketId, "target" to request.target))
    readFrames(peer, socketId)
  }

  private fun readFrames(peer: Peer, socketId: String) {
    val input = peer.input
    var fragmentOpcode = 0
    val fragments = ByteArrayOutputStream()
    while (!peer.closed.get()) {
      val first = input.read()
      val second = input.read()
      if (first < 0 || second < 0) throw EOFException()
      val fin = (first and 0x80) != 0
      val opcode = first and 0x0F
      if ((first and 0x70) != 0 || (second and 0x80) == 0) return fail(peer, 1002)
      var length = (second and 0x7F).toLong()
      if (length == 126L) {
        val bytes = readExactly(input, 2)
        length = (((bytes[0].toInt() and 0xFF) shl 8) or (bytes[1].toInt() and 0xFF)).toLong()
      } else if (length == 127L) {
        length = 0
        for (byte in readExactly(input, 8)) length = (length shl 8) or (byte.toLong() and 0xFF)
      }
      if ((opcode and 0x08) != 0 && (!fin || length > 125)) return fail(peer, 1002)
      if (length < 0 || length > MAX_MESSAGE_BYTES) return fail(peer, 1009)
      val mask = readExactly(input, 4)
      val payload = readExactly(input, length.toInt())
      for (index in payload.indices) payload[index] = (payload[index].toInt() xor mask[index and 3].toInt()).toByte()
      when (opcode) {
        0x0 -> {
          if (fragmentOpcode == 0) return fail(peer, 1002)
          if (fragments.size() + payload.size > MAX_MESSAGE_BYTES) return fail(peer, 1009)
          fragments.write(payload)
          if (fin) {
            val message = fragments.toByteArray()
            val messageOpcode = fragmentOpcode
            fragments.reset()
            fragmentOpcode = 0
            if (!deliver(peer, socketId, messageOpcode, message)) return
          }
        }
        0x1, 0x2 -> {
          if (fragmentOpcode != 0) return fail(peer, 1002)
          if (fin) {
            if (!deliver(peer, socketId, opcode, payload)) return
          } else {
            fragmentOpcode = opcode
            fragments.write(payload)
          }
        }
        0x8 -> return closeReceived(peer, payload)
        0x9 -> if (!peer.closing.get()) sendFrame(peer, 0xA, payload)
        0xA -> Unit
        else -> return fail(peer, 1002)
      }
    }
  }

  /** Returns false when the text is not valid UTF-8 and the socket closes. */
  private fun deliver(peer: Peer, socketId: String, opcode: Int, message: ByteArray): Boolean {
    if (peer.closing.get()) return true
    if (opcode == 0x1) {
      val text = decodeUtf8(message) ?: return false.also { fail(peer, 1007) }
      emit("onSocketMessage", mapOf("socketId" to socketId, "text" to text))
    } else {
      emit("onSocketMessage", mapOf("socketId" to socketId, "binaryBase64" to Base64.encodeToString(message, Base64.NO_WRAP)))
    }
    return true
  }

  private fun closeReceived(peer: Peer, payload: ByteArray) {
    // The page answered the close that the server sent.
    if (peer.closing.get()) return drop(peer)
    var code = 1005
    var reason = ""
    if (payload.size == 1) return fail(peer, 1002)
    if (payload.size >= 2) {
      code = ((payload[0].toInt() and 0xFF) shl 8) or (payload[1].toInt() and 0xFF)
      if (!validCloseCode(code)) return fail(peer, 1002)
      reason = decodeUtf8(payload.copyOfRange(2, payload.size)) ?: return fail(peer, 1007)
    }
    if (!peer.closing.compareAndSet(false, true)) return drop(peer)
    report(peer, code, reason)
    sendFrame(peer, 0x8, closePayload(if (code == 1005) 1000 else code, "")) { drop(peer) }
  }

  /** A frame that breaks the protocol ends the socket at once. */
  private fun fail(peer: Peer, code: Int) {
    if (peer.closing.get()) return drop(peer)
    closeSocket(peer, code, "", wait = false)
  }

  /**
   * Reports the close once, sends a close frame, and ends the connection after the page answers or after
   * a short time.
   */
  private fun closeSocket(peer: Peer, code: Int, reason: String, wait: Boolean = true) {
    if (peer.closed.get() || !peer.closing.compareAndSet(false, true)) return
    report(peer, code, reason)
    sendFrame(peer, 0x8, closePayload(code, reason)) { ok -> if (!ok || !wait) drop(peer) }
    if (schedule(CLOSE_TIMEOUT_MS) { drop(peer) } == null) drop(peer)
  }

  private fun report(peer: Peer, code: Int, reason: String) {
    val socketId = peer.socketId ?: return
    if (sockets.remove(socketId, peer)) {
      emit("onSocketClose", mapOf("socketId" to socketId, "code" to code, "reason" to reason))
    }
  }

  private fun sendFrame(peer: Peer, opcode: Int, payload: ByteArray, done: ((Boolean) -> Unit)? = null) {
    if (peer.closed.get()) return
    val size = payload.size
    val header = ByteArrayOutputStream(10)
    header.write(0x80 or opcode)
    when {
      size < 126 -> header.write(size)
      size <= 0xFFFF -> {
        header.write(126)
        header.write(size shr 8)
        header.write(size and 0xFF)
      }
      else -> {
        header.write(127)
        for (shift in 56 downTo 0 step 8) header.write(((size.toLong() shr shift) and 0xFF).toInt())
      }
    }
    peer.write(header.toByteArray() + payload) { ok ->
      if (done != null) done(ok) else if (!ok) drop(peer)
    }
  }
}

// Helpers

private fun readExactly(input: InputStream, count: Int): ByteArray {
  val bytes = ByteArray(count)
  var offset = 0
  while (offset < count) {
    val read = input.read(bytes, offset, count - offset)
    if (read < 0) throw EOFException()
    offset += read
  }
  return bytes
}

private fun decodeUtf8(bytes: ByteArray): String? =
  try {
    Charsets.UTF_8
      .newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(bytes))
      .toString()
  } catch (error: CharacterCodingException) {
    null
  }

/** An HTTP token, such as a header name. */
private fun isToken(value: String): Boolean =
  value.isNotEmpty() && value.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in TOKEN_SYMBOLS }

private fun validCloseCode(code: Int): Boolean =
  (code in 1000..1014 && code != 1004 && code != 1005 && code != 1006) || code in 3000..4999

/** The same rule as the desktop proxy: a reserved code cannot cross the socket, and an abnormal close stays a failure. */
private fun sendableCloseCode(code: Int): Int =
  when {
    code == 1005 -> 1000
    validCloseCode(code) -> code
    else -> 1011
  }

private fun closePayload(code: Int, reason: String): ByteArray =
  byteArrayOf(((code shr 8) and 0xFF).toByte(), (code and 0xFF).toByte()) + reason.toByteArray(Charsets.UTF_8)

/** Cuts the text at a character boundary so that its UTF-8 form has at most `bytes` bytes. */
private fun truncated(text: String, bytes: Int): String {
  val result = StringBuilder()
  var count = 0
  var index = 0
  while (index < text.length) {
    val codePoint = text.codePointAt(index)
    val size =
      when {
        codePoint < 0x80 -> 1
        codePoint < 0x800 -> 2
        codePoint < 0x10000 -> 3
        else -> 4
      }
    if (count + size > bytes) break
    count += size
    result.appendCodePoint(codePoint)
    index += Character.charCount(codePoint)
  }
  return result.toString()
}

private fun closeQuietly(closeable: Closeable?) {
  try {
    closeable?.close()
  } catch (error: IOException) {
    // Nothing to do.
  }
}

private fun reasonPhrase(status: Int): String =
  when (status) {
    200 -> "OK"
    201 -> "Created"
    204 -> "No Content"
    206 -> "Partial Content"
    301 -> "Moved Permanently"
    302 -> "Found"
    304 -> "Not Modified"
    400 -> "Bad Request"
    401 -> "Unauthorized"
    403 -> "Forbidden"
    404 -> "Not Found"
    405 -> "Method Not Allowed"
    408 -> "Request Timeout"
    411 -> "Length Required"
    413 -> "Content Too Large"
    426 -> "Upgrade Required"
    431 -> "Request Header Fields Too Large"
    500 -> "Internal Server Error"
    502 -> "Bad Gateway"
    503 -> "Service Unavailable"
    504 -> "Gateway Timeout"
    else -> "Status"
  }

class RemoteViewerProxyModule : Module() {
  private val server = RemoteViewerServer { name, body -> sendEvent(name, body) }

  override fun definition() =
    ModuleDefinition {
      Name("OpenBotRemoteViewerProxy")

      Events("onRequest", "onSocketOpen", "onSocketMessage", "onSocketClose")

      /** Stops an earlier server, then listens on 127.0.0.1 on a free port, and returns the port. */
      AsyncFunction("start") { token: String -> server.start(token) }

      /** Closes the listener, every connection and every socket. */
      AsyncFunction("stop") { server.stop() }

      AsyncFunction("respond") { requestId: String, status: Int, headers: Map<String, String>, bodyBase64: String ->
        server.respond(requestId, status, headers, bodyBase64)
      }

      AsyncFunction("socketSend") { socketId: String, text: String?, binaryBase64: String? ->
        server.socketSend(socketId, text, binaryBase64)
      }

      AsyncFunction("socketClose") { socketId: String, code: Int, reason: String ->
        server.socketClose(socketId, code, reason)
      }

      /** Keeps the remote desktop out of screenshots, screen recordings and the recent apps. */
      AsyncFunction("setSecure") { enabled: Boolean -> setSecure(enabled) }.runOnQueue(Queues.MAIN)

      OnDestroy { server.destroy() }
    }

  private fun setSecure(enabled: Boolean) {
    val window = appContext.currentActivity?.window ?: return
    if (enabled) {
      window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}
