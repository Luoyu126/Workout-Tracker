export function normalizeRequiredText(value: string) {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined));
}
