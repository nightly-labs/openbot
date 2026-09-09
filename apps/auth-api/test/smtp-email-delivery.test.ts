import { describe, expect, it, vi } from "vitest";
import { createEmailCodeDelivery } from "../src/server/email-delivery";
import { type SmtpConnector, sendPrivateEmailCode, sendPrivateTeamInvite } from "../src/server/smtp-email-delivery";

const SUCCESS_RESPONSES = [
  "220 mail.privateemail.com ready",
  "250-mail.privateemail.com",
  "250 AUTH LOGIN",
  "334 VXNlcm5hbWU6",
  "334 UGFzc3dvcmQ6",
  "235 Authentication successful",
  "250 Sender accepted",
  "250 Recipient accepted",
  "354 End data with <CR><LF>.<CR><LF>",
  "250 Message accepted",
  "221 Bye",
].join("\r\n");

describe("Private Email SMTP delivery", () => {
  it("sends a one-time host invitation to the selected email", async () => {
    const writes: string[] = [];
    const connector: SmtpConnector = () => ({
      opened: Promise.resolve(),
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${SUCCESS_RESPONSES}\r\n`));
          controller.close();
        },
      }),
      writable: new WritableStream({
        write(chunk) {
          writes.push(new TextDecoder().decode(chunk));
        },
      }),
      close() {},
    });

    await sendPrivateTeamInvite(
      {
        host: "mail.privateemail.com",
        port: 465,
        username: "hello@openbot.run",
        password: "app-password-value",
        from: "hello@openbot.run",
      },
      {
        email: "alice@example.com",
        inviterEmail: "owner@example.com",
        serverName: "Studio Mac",
        inviteUrl:
          "https://openbot.run/join?api=https%3A%2F%2Fstudio-mac-k7m4q2pz-host.openbot.run%2F&server=00000000-0000-4000-8000-000000000000&fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&invite=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        role: "member",
      },
      connector,
    );

    expect(writes).toContain("RCPT TO:<alice@example.com>\r\n");
    expect(writes[7]).toContain("Subject: Join Studio Mac on OpenBot");
    expect(writes[7]).toContain("owner@example.com invited you");
    expect(writes[7]).toContain("https://openbot.run/join?");
  });

  it("uses TLS on port 465 and sends the code without SMTP injection", async () => {
    const writes: string[] = [];
    const addresses: unknown[] = [];
    let closed = false;
    const connector: SmtpConnector = (address, options) => {
      addresses.push(address, options);
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${SUCCESS_RESPONSES}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream({
          write(chunk) {
            writes.push(new TextDecoder().decode(chunk));
          },
        }),
        close() {
          closed = true;
        },
      };
    };

    await sendPrivateEmailCode(
      {
        host: "mail.privateemail.com",
        port: 465,
        username: "hello@openbot.run",
        password: "app-password-value",
        from: "hello@openbot.run",
      },
      {
        email: "person@example.com",
        code: "ABCD-EFGH",
        expiresAt: Date.now() + 10 * 60_000,
      },
      connector,
    );

    expect(addresses).toEqual([
      { hostname: "mail.privateemail.com", port: 465 },
      { secureTransport: "on", allowHalfOpen: false },
    ]);
    expect(writes.slice(0, 8)).toEqual([
      "EHLO openbot.run\r\n",
      "AUTH LOGIN\r\n",
      `${btoa("hello@openbot.run")}\r\n`,
      `${btoa("app-password-value")}\r\n`,
      "MAIL FROM:<hello@openbot.run>\r\n",
      "RCPT TO:<person@example.com>\r\n",
      "DATA\r\n",
      expect.stringContaining("ABCD-EFGH"),
    ]);
    expect(writes[7]).toContain("Subject: Your OpenBot sign-in code");
    expect(writes[7]?.endsWith("\r\n.\r\n")).toBe(true);
    expect(writes[8]).toBe("QUIT\r\n");
    expect(closed).toBe(true);
  });

  it("rejects header injection before opening a socket", async () => {
    let connected = false;
    await expect(
      sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "secret",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com\r\nBcc: attacker@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        (() => {
          connected = true;
          throw new Error("must_not_connect");
        }) satisfies SmtpConnector,
      ),
    ).rejects.toThrow("smtp_invalid_recipient");
    expect(connected).toBe(false);
  });

  it("does not expose credentials in SMTP errors", async () => {
    const connector: SmtpConnector = () => ({
      opened: Promise.resolve(),
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("220 ready\r\n500 rejected\r\n"));
          controller.close();
        },
      }),
      writable: new WritableStream(),
      close() {},
    });
    const password = "private-app-password";
    const error = await sendPrivateEmailCode(
      {
        host: "mail.privateemail.com",
        port: 465,
        username: "hello@openbot.run",
        password,
        from: "hello@openbot.run",
      },
      {
        email: "person@example.com",
        code: "ABCD-EFGH",
        expiresAt: Date.now() + 10 * 60_000,
      },
      connector,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error.");
    expect(error.message).toBe("smtp_ehlo_failed");
    expect(error.message).not.toContain(password);
  });

  it("retries transport failures but not protocol failures", async () => {
    let attempts = 0;
    const writes: string[] = [];
    const connector: SmtpConnector = () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          opened: Promise.reject(new Error("network details that must not escape")),
          readable: new ReadableStream(),
          writable: new WritableStream(),
          close() {},
        };
      }
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${SUCCESS_RESPONSES}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream({
          write(chunk) {
            writes.push(new TextDecoder().decode(chunk));
          },
        }),
        close() {},
      };
    };

    await sendPrivateEmailCode(
      {
        host: "mail.privateemail.com",
        port: 465,
        username: "hello@openbot.run",
        password: "app-password-value",
        from: "hello@openbot.run",
      },
      {
        email: "person@example.com",
        code: "ABCD-EFGH",
        expiresAt: Date.now() + 10 * 60_000,
      },
      connector,
    );

    expect(attempts).toBe(2);
    expect(writes).toContain("QUIT\r\n");
  });

  it("preserves a confirmed pre-DATA rejection when socket cleanup fails", async () => {
    let attempts = 0;
    const responses = [
      "220 mail.privateemail.com ready",
      "250-mail.privateemail.com",
      "250 AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "535 Authentication rejected",
    ].join("\r\n");
    const connector: SmtpConnector = () => {
      attempts += 1;
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${responses}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream(),
        close: () => Promise.reject(new Error("socket cleanup failed")),
      };
    };

    await expect(
      sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "app-password-value",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        connector,
      ),
    ).rejects.toThrow("smtp_auth_failed");
    expect(attempts).toBe(1);
  });

  it("does not retry a timed-out session when socket closure cannot be confirmed", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const connector: SmtpConnector = () => {
      attempts += 1;
      return {
        opened: new Promise(() => undefined),
        readable: new ReadableStream(),
        writable: new WritableStream(),
        close: () => new Promise(() => undefined),
      };
    };

    try {
      const delivery = sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "app-password-value",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        connector,
      );
      const outcome = expect(delivery).rejects.toThrow("smtp_delivery_unknown");

      await vi.advanceTimersByTimeAsync(8_000);
      await outcome;
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the final delivery state when a timed-out session advances during socket closure", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const connector: SmtpConnector = () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          opened: new Promise((resolve) => setTimeout(resolve, 7_600)),
          readable: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`${SUCCESS_RESPONSES}\r\n`));
              controller.close();
            },
          }),
          writable: new WritableStream(),
          close: () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
        };
      }
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${SUCCESS_RESPONSES}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream(),
        close() {},
      };
    };

    try {
      const delivery = sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "app-password-value",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        connector,
      );
      const outcome = expect(delivery).resolves.toBeUndefined();

      await vi.advanceTimersByTimeAsync(8_000);
      await outcome;
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry after message submission has started", async () => {
    let attempts = 0;
    const responses = SUCCESS_RESPONSES.split("\r\n").slice(0, 9).join("\r\n");
    const connector: SmtpConnector = () => {
      attempts += 1;
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${responses}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream(),
        close() {},
      };
    };

    await expect(
      sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "app-password-value",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        connector,
      ),
    ).rejects.toThrow("smtp_delivery_unknown");
    expect(attempts).toBe(1);
  });

  it("reports a confirmed post-DATA rejection as a delivery failure", async () => {
    let attempts = 0;
    const responses = `${SUCCESS_RESPONSES.split("\r\n").slice(0, 9).join("\r\n")}\r\n550 Message rejected`;
    const connector: SmtpConnector = () => {
      attempts += 1;
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${responses}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream(),
        close() {},
      };
    };

    await expect(
      sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "app-password-value",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        connector,
      ),
    ).rejects.toThrow("smtp_message_failed");
    expect(attempts).toBe(1);
  });

  it("accepts confirmed delivery when the QUIT response is lost", async () => {
    let attempts = 0;
    const responses = SUCCESS_RESPONSES.split("\r\n").slice(0, 10).join("\r\n");
    const connector: SmtpConnector = () => {
      attempts += 1;
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${responses}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream(),
        close() {},
      };
    };

    await expect(
      sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "app-password-value",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        connector,
      ),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(1);
  });

  it("reports a spent sender quota as a rate-limited delivery", async () => {
    let attempts = 0;
    const warnings: unknown[][] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    const responses = [
      ...SUCCESS_RESPONSES.split("\r\n").slice(0, 8),
      "554 5.7.1 <person@example.com>: Data command rejected: Reject: too many messages from sender in last 60 minutes",
    ].join("\r\n");
    const connector: SmtpConnector = () => {
      attempts += 1;
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${responses}\r\n`));
            controller.close();
          },
        }),
        writable: new WritableStream(),
        close() {},
      };
    };

    try {
      await expect(
        sendPrivateEmailCode(
          {
            host: "mail.privateemail.com",
            port: 465,
            username: "hello@openbot.run",
            password: "app-password-value",
            from: "hello@openbot.run",
          },
          {
            email: "person@example.com",
            code: "ABCD-EFGH",
            expiresAt: Date.now() + 10 * 60_000,
          },
          connector,
        ),
      ).rejects.toThrow("email_delivery_rate_limited");
    } finally {
      warn.mockRestore();
    }

    expect(attempts).toBe(1);
    expect(JSON.stringify(warnings)).not.toContain("person@example.com");
  });

  it("reports any temporary refusal as a rate-limited delivery", async () => {
    let attempts = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const connector: SmtpConnector = () => {
      attempts += 1;
      return {
        opened: Promise.resolve(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("421 4.7.0 Service unavailable\r\n"));
            controller.close();
          },
        }),
        writable: new WritableStream(),
        close() {},
      };
    };

    try {
      await expect(
        sendPrivateEmailCode(
          {
            host: "mail.privateemail.com",
            port: 465,
            username: "hello@openbot.run",
            password: "app-password-value",
            from: "hello@openbot.run",
          },
          {
            email: "person@example.com",
            code: "ABCD-EFGH",
            expiresAt: Date.now() + 10 * 60_000,
          },
          connector,
        ),
      ).rejects.toThrow("email_delivery_rate_limited");
    } finally {
      warn.mockRestore();
    }

    expect(attempts).toBe(1);
  });

  it("keeps a recipient mailbox refusal a delivery failure", async () => {
    const responses = [...SUCCESS_RESPONSES.split("\r\n").slice(0, 7), "552 5.2.2 Mailbox quota exceeded"].join("\r\n");
    const connector: SmtpConnector = () => ({
      opened: Promise.resolve(),
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${responses}\r\n`));
          controller.close();
        },
      }),
      writable: new WritableStream(),
      close() {},
    });

    await expect(
      sendPrivateEmailCode(
        {
          host: "mail.privateemail.com",
          port: 465,
          username: "hello@openbot.run",
          password: "app-password-value",
          from: "hello@openbot.run",
        },
        {
          email: "person@example.com",
          code: "ABCD-EFGH",
          expiresAt: Date.now() + 10 * 60_000,
        },
        connector,
      ),
    ).rejects.toThrow("smtp_recipient_failed");
  });

  it("reports a rate-limited delivery webhook apart from other webhook failures", async () => {
    const fetchCall = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const delivery = createEmailCodeDelivery({ EMAIL_DELIVERY_WEBHOOK_URL: "https://mail.example.test/send" });
    const message = { email: "person@example.com", code: "ABCD-EFGH", expiresAt: Date.now() + 10 * 60_000 };

    try {
      await expect(delivery?.send(message)).rejects.toThrow("email_delivery_rate_limited");
      await expect(delivery?.send(message)).rejects.toThrow("email_delivery_webhook_failed");
    } finally {
      fetchCall.mockRestore();
    }
  });

  it("rejects partial SMTP configuration", () => {
    expect(() =>
      createEmailCodeDelivery({
        EMAIL_SMTP_HOST: "mail.privateemail.com",
      }),
    ).toThrow("SMTP email delivery configuration is incomplete.");
  });

  it("treats blank SMTP variables as no delivery method", () => {
    expect(
      createEmailCodeDelivery({
        EMAIL_SMTP_HOST: "",
        EMAIL_SMTP_PORT: "",
        EMAIL_SMTP_USERNAME: "",
        EMAIL_SMTP_PASSWORD: "",
        EMAIL_FROM: "",
      }),
    ).toBeNull();
  });
});
