// Characters with a meaning in a regular expression. Escaping each one makes the
// pattern match them as themselves, so a filter of "c++" looks for "c++".
const REGEX_SYNTAX = /[.*+?^${}()|[\]\\]/g;

// `text` with every occurrence of `q` wrapped in <mark>, ignoring case. A filter
// can be any text a user types, so it becomes React text nodes, never HTML: a
// Food named "<b>" shows as "<b>", and nothing in it can run.
//
// split() with a capture group keeps the matches in its result, at the odd
// indexes, with the text between them at the even ones:
// "BBQ Chicken Shack".split(/(chicken)/i) is ["BBQ ", "Chicken", " Shack"].
// Each piece is a slice of the original text, so the original case shows.
export function Highlight({ text, q }: { text: string; q: string }) {
  if (q === "") {
    return text;
  }
  const pattern = new RegExp(`(${q.replace(REGEX_SYNTAX, "\\$&")})`, "iu");
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      // The pieces of one name never reorder, so the index is a stable key.
      <mark key={index} className="rounded-sm bg-yellow-200 text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
