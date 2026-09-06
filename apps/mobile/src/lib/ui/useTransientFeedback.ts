import { useCallback, useEffect, useState } from "react";

// Pause while the page hides feedback behind its loading indicator.
export function useTransientFeedback<T = string>(isHidden = false) {
  const [entry, setEntry] = useState<{ value: T } | null>(null);
  const setFeedback = useCallback((value: T | null) => {
    // A new entry also restarts the timer for repeated, identical messages.
    setEntry(value === null ? null : { value });
  }, []);

  useEffect(() => {
    if (entry === null || isHidden) return;
    const timer = setTimeout(() => setEntry(null), 3000);
    return () => clearTimeout(timer);
  }, [entry, isHidden]);

  return [entry === null ? null : entry.value, setFeedback] as const;
}
