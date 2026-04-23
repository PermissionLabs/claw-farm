// Strip JS-style comments from JSON-with-comments text.
// Supported: line comments (two slashes), block comments,
// UTF-8 strings with escape handling. Not supported: regex literals,
// template strings, nested block comments.
export function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    // String literal — pass through unchanged
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          result += text[i] + (text[i + 1] ?? "");
          i += 2;
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
    } else if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
}
