"use client";

import { useEffect, useState } from "react";

/**
 * Live-updating countdown that adapts format based on remaining time:
 * - >= 1 day:  "5d 12h"
 * - >= 1 hr:   "5h 23m"
 * - >= 1 min:  "5m 30s"
 * - <  1 min:  "30s"
 * - <= 0:      "Closed"
 *
 * Updates every second. Renders an empty string on first paint to avoid
 * SSR/CSR hydration mismatches (Date.now() differs between server and
 * client), then fills in after mount.
 */
export function Countdown({
  closeTime,
  className,
}: {
  closeTime: string | null;
  className?: string;
}) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    if (!closeTime) {
      setRemaining("No deadline");
      return;
    }
    const deadline = closeTime;
    function update() {
      setRemaining(formatRemaining(deadline));
    }
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [closeTime]);

  return <span className={className}>{remaining}</span>;
}

function formatRemaining(closeTime: string): string {
  const diff = new Date(closeTime).getTime() - Date.now();
  if (diff <= 0) return "Closed";

  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;

  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
