"use client";

import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  type?: "success" | "error";
  duration?: number;
  onDone: () => void;
}

export function Toast({ message, type = "success", duration = 3000, onDone }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 300); // Wait for exit animation
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDone]);

  const colors =
    type === "success"
      ? "border-yes/30 bg-yes/10 text-yes"
      : "border-no/30 bg-no/10 text-no";

  return (
    <div
      className={`fixed bottom-6 right-4 z-[60] max-w-xs px-4 py-3 rounded-lg border backdrop-blur-md transition-all duration-300 ${colors} ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{type === "success" ? "✓" : "✕"}</span>
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
}
