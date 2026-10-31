### Fixed

- A pasted sign-in code now works when the field already has part of a code, and when the pasted
  text has words around the code. Before, the app could send a wrong code and show "incorrect".
- A code that an agent asks for, such as a two-step code, now accepts a paste with a space, a dash
  or a prefix, such as "123 456" or "G-123456". Before, the field cut the pasted text, and digits
  were lost.
