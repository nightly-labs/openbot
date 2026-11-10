### Changed

- The agent's browser now clicks the checkbox of a Turnstile, reCAPTCHA or hCaptcha check one time
  before it asks you to take over the tab. This includes the Cloudflare "Just a moment..." page.
  Many of these checks pass with this click. An image puzzle still goes to you, and no page data
  goes to a CAPTCHA service.
