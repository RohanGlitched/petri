import { tokenize, type Lang } from "./highlight";
import { CopyButton } from "./CopyButton";

/** A code block: a caption saying what it is (a file, a shell, a network), the code, and a copy button. */
export function Code({ children, lang = "text", title, copy = true }: { children: string; lang?: Lang; title?: string; copy?: boolean }) {
  const code = children.replace(/^\n+|\s+$/g, "");
  const tokens = tokenize(code, lang);
  return (
    <figure className="d-code">
      {(title || copy) && (
        <figcaption>
          <span>{title ?? LANG_LABEL[lang]}</span>
          {copy && <CopyButton text={code} />}
        </figcaption>
      )}
      <pre tabIndex={0}>
        <code>
          {tokens.map((t, i) =>
            t.k ? (
              <span key={i} className={`t-${t.k}`}>
                {t.t}
              </span>
            ) : (
              t.t
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}

const LANG_LABEL: Record<Lang, string> = { sh: "Shell", json: "JSON", rust: "Rust", ts: "TypeScript", text: "Text" };

/** Inline code. */
export const C = ({ children }: { children: React.ReactNode }) => <code className="d-ic">{children}</code>;
