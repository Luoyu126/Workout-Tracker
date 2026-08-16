export function normalizeTeamName(value: string) {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function normalizeOptionalTeamText(value: string) {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function normalizeMemberUserId(value: string) {
  const normalizedValue = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalizedValue
  )
    ? normalizedValue
    : null;
}
