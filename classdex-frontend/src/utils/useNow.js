import { useEffect, useState } from "react";

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    const intervalId = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", tick);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);

  return now;
}
