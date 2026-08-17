// The API serializes timestamps with microsecond precision, so fractional
// seconds must accept more than the three digits JavaScript itself emits.
const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseIsoDateTime(value: string) {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0 || !isoDateTimePattern.test(normalizedValue)) {
    return null;
  }
  const parsedDate = new Date(normalizedValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
}

export function parseOptionalIsoDateTime(value: string) {
  return value.trim().length > 0 ? parseIsoDateTime(value) : null;
}

export function isValidEventSchedule(
  startTime: string,
  endTime: string | null,
  signupDeadline: string | null
) {
  const startTimestamp = Date.parse(startTime);
  if (Number.isNaN(startTimestamp)) {
    return false;
  }
  if (endTime !== null && Date.parse(endTime) <= startTimestamp) {
    return false;
  }
  if (signupDeadline !== null && Date.parse(signupDeadline) > startTimestamp) {
    return false;
  }
  return true;
}

export function isSignupOpen(signupDeadline: string | null, startTime: string, now: Date = new Date()) {
  const effectiveDeadline = signupDeadline ?? startTime;
  const deadlineTimestamp = Date.parse(effectiveDeadline);
  if (Number.isNaN(deadlineTimestamp)) {
    return false;
  }
  return now.getTime() <= deadlineTimestamp;
}

export function parseNonNegativeInteger(value: string) {
  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }
  const parsedValue = Number.parseInt(normalizedValue, 10);
  return Number.isNaN(parsedValue) ? null : parsedValue;
}

export function parseOptionalNonNegativeInteger(value: string) {
  return value.trim().length > 0 ? parseNonNegativeInteger(value) : null;
}

export function parseMatchMinute(value: string) {
  return parseNonNegativeInteger(value);
}

export function isValidMatchScoreResult(
  teamScore: number | null,
  opponentScore: number | null,
  result: "win" | "draw" | "loss" | null
) {
  if ((teamScore === null) !== (opponentScore === null)) {
    return false;
  }
  if (result !== null && (teamScore === null || opponentScore === null)) {
    return false;
  }
  if (teamScore === null || opponentScore === null || result === null) {
    return true;
  }
  if (teamScore > opponentScore) {
    return result === "win";
  }
  if (teamScore < opponentScore) {
    return result === "loss";
  }
  return result === "draw";
}
