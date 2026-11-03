// A very small highlighter for the docs' code blocks: strings, numbers, comments, keywords and a few punctuation
// marks. It never changes the text, only wraps pieces of it, so what you copy is exactly what is shown.

export type Lang = "sh" | "json" | "rust" | "ts" | "text";
export type Token = { t: string; k?: "s" | "n" | "c" | "k" | "f" | "p" };

const KEYWORDS: Record<Lang, string[]> = {
  sh: ["near", "node", "cargo", "curl", "git", "cd", "npm", "npx", "docker", "wsl", "echo", "export"],
  json: ["true", "false", "null"],
  rust: ["pub", "fn", "let", "mut", "if", "else", "match", "for", "in", "return", "struct", "enum", "impl", "use", "const", "as", "Some", "None", "Ok", "Err", "self", "Self", "u16", "u32", "u64", "u128", "bool", "String", "Vec", "Option", "while", "loop", "break"],
  ts: ["const", "let", "await", "async", "function", "return", "import", "from", "export", "type", "new", "if", "else", "true", "false", "null", "undefined"],
  text: [],
};

export function tokenize(code: string, lang: Lang): Token[] {
  if (lang === "text") return [{ t: code }];
  const out: Token[] = [];
  const kw = new Set(KEYWORDS[lang]);
  const lineComment = lang === "sh" ? "#" : lang === "json" ? null : "//";
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) out.push({ t: plain });
    plain = "";
  };
  while (i < code.length) {
    const ch = code[i];
    const prev = i === 0 ? "\n" : code[i - 1];
    // Comments run to the end of the line. In shell, a # only starts one at a word boundary.
    if (lineComment && code.startsWith(lineComment, i) && (lang !== "sh" || /\s/.test(prev))) {
      flush();
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      out.push({ t: code.slice(i, stop), k: "c" });
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || (ch === "`" && lang === "ts")) {
      flush();
      let j = i + 1;
      while (j < code.length && code[j] !== ch) {
        if (code[j] === "\\" && ch !== "'") j++;
        j++;
      }
      out.push({ t: code.slice(i, j + 1), k: "s" });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_.-]/.test(prev)) {
      flush();
      let j = i;
      while (j < code.length && /[0-9_.xa-fA-F]/.test(code[j])) j++;
      const num = code.slice(i, j);
      // Words that merely start with a digit (hashes, account names) stay plain.
      if (j < code.length && /[A-Za-z]/.test(code[j]) && !/^0x/.test(num)) {
        plain += num;
      } else out.push({ t: num, k: "n" });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch) && !/[A-Za-z0-9_.-]/.test(prev)) {
      let j = i;
      while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (kw.has(word)) {
        flush();
        out.push({ t: word, k: "k" });
      } else if (lang !== "sh" && code[j] === "(") {
        flush();
        out.push({ t: word, k: "f" });
      } else plain += word;
      i = j;
      continue;
    }
    if (lang === "sh" && ch === "-" && /\s/.test(prev) && code[i + 1] === "-") {
      flush();
      let j = i;
      while (j < code.length && /[A-Za-z0-9-]/.test(code[j])) j++;
      out.push({ t: code.slice(i, j), k: "p" });
      i = j;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}
