/**
 * `<dialog>`'s own methods, for jsdom, which parses the element but implements none of them.
 *
 * Only the part a test can observe is filled in: whether the dialog is open, and the `close` event
 * that follows it closing. Nothing here models the modal behaviour the browser gives - the focus,
 * the backdrop, the page behind it going inert - because a test cannot assert those in jsdom and a
 * stand-in that pretended to would be worse than none.
 */
const dialogPrototype = globalThis.HTMLDialogElement?.prototype;

if (dialogPrototype && typeof dialogPrototype.showModal !== "function") {
  const show = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  dialogPrototype.show = show;
  dialogPrototype.showModal = show;
  dialogPrototype.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
