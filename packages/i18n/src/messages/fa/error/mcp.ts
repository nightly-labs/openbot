import { defineMessages } from "../../../message";

export const messages = defineMessages("error.mcp", {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "این نشانی با نام میزبان در دسترس نیست.",
  "error.mcp.redirectGetOnly": "این نشانی فقط به درخواست GET پاسخ می‌دهد.",
  "error.mcp.redirectNotSignIn": "این نشانی بخشی از فرایند ورود نیست.",
  "error.mcp.redirectRefused": "ورود رد شد. به OpenBot برگردید و دوباره تلاش کنید.",
  "error.mcp.redirectNoSignIn": "هیچ فرایند ورودی منتظر این مورد نیست؛ شاید پایان یافته باشد.",
  "error.mcp.redirectSignedIn": "ورود OpenBot انجام شد. می‌توانید این پنجره را ببندید.",
  "error.mcp.signInFileUnreadable": "فایل ورود MCP خواندنی نیست.",
  "error.mcp.signInFileTooLarge": "فایل ورود MCP بیش از حد بزرگ است.",
  "error.mcp.unsupported": "این سرور از سرورهای MCP پشتیبانی نمی‌کند.",
  "error.mcp.signInOnHost": "ورود به سرور MCP فقط از OpenBot در رایانهٔ میزبان امکان‌پذیر است.",
  "error.mcp.signInAppUnsupported": "این سرور از برنامه‌های ورود پشتیبانی نمی‌کند. OpenBot را در میزبان به‌روز کنید.",
  "error.mcp.redirectRelayed": "OpenBot فرایند ورود را به سرور فرستاد. می‌توانید این پنجره را ببندید.",
  "error.mcp.relayEnded": "این فرایند ورود پایان یافت. آن را دوباره شروع کنید.",
  "error.mcp.relayNoState": "صفحهٔ ورود سرور از نشانی بازگشت محافظت نمی‌کند؛ بنابراین OpenBot آن را در این رایانه باز نمی‌کند.",
  "error.mcp.relayAddressInvalid": "این نشانی، نشانی پایانی این فرایند ورود نیست. نشانی کامل را از مرورگر کپی کنید.",
});
