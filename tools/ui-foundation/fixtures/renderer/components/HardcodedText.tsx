declare const toast: ((message: string) => void) & { error: (message: string) => void };
declare const Alert: { alert: (title: string, message?: string) => void };
declare const text: { errorMessage: (error: unknown, fallback: string) => string };
declare const error: unknown;
declare function SearchField(props: { placeholder: string }): null;

export function notify(): void {
  toast.error("Could not save the file."); // flag
  toast(`Saved`); // flag
  Alert.alert("Delete this chat?"); // flag
  text.errorMessage(error, "Could not load the chat."); // flag
}

export const plain = <p>Hello world</p>; // flag
export const japanese = <p>日本語</p>; // flag
export const literalChild = <p>{"Loading"}</p>; // flag
export const accessibleName = <a href="/" aria-label="Close" />; // flag
export const tooltip = <span title={"Open the file"} />; // flag
export const hint = <SearchField placeholder='Search' />; // flag
export const image = <img alt={`Profile photo`} src="a.png" />; // flag
