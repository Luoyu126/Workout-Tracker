export type SignupBoardPeriod = "week" | "month" | "all";
export type SignupBoardEventType = "training" | "match";

export function signupBoardDateRange(period: SignupBoardPeriod, now = new Date()) {
  if (period === "all") {
    return {};
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (period === "week") {
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 1);
  }
  // The API's starts_before boundary is inclusive.
  end.setMilliseconds(-1);
  return { startsAfter: start.toISOString(), startsBefore: end.toISOString() };
}

export function toggleSignupBoardEventType(selected: SignupBoardEventType[], type: SignupBoardEventType) {
  if (selected.includes(type)) {
    return selected.length === 1 ? selected : selected.filter((value) => value !== type);
  }
  // Keep query parameter order stable whichever button was toggled first.
  return (["training", "match"] as const).filter((value) => selected.includes(value) || value === type);
}
