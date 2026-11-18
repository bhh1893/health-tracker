// `name` and `email` come from Google through the proxy's trusted headers and are
// stored as sent (ADR 0022). Either can be null, and a blank one is treated the same.
export function present(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

// The avatar's one letter: first of `name`, else of `email`, else null for the
// person icon. Array.from splits by code point, so a name starting with a character
// outside the Basic Multilingual Plane is not cut in half.
export function avatarLetter(
  name: string | null,
  email: string | null,
): string | null {
  const source = present(name) ?? present(email) ?? "";
  return Array.from(source)[0]?.toUpperCase() ?? null;
}
