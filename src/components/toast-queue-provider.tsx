"use client";

import type { JSX } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Global toast queue.
 *
 * Wraps (does not replace) `src/components/toast.tsx`. Renders up to 5
 * stacked toasts in the bottom-right corner; when a 6th arrives the
 * oldest is dropped (MASTER D13). Error toasts get `role="alert"`
 * (REVIEW D23 / P1-6); success toasts get `role="status"`.
 */
export interface ToastInput {
  message: string;
  type: "success" | "error";
  duration?: number;
}

export interface ToastQueueCtx {
  push(t: ToastInput): void;
}

interface ToastEntry {
  id: number;
  message: string;
  type: "success" | "error";
  duration: number;
  visible: boolean;
}

const MAX_TOASTS = 5;
const DEFAULT_SUCCESS_MS = 2500;
const DEFAULT_ERROR_MS = 4000;
const EXIT_ANIM_MS = 300;
const STACK_OFFSET_PX = 64;

const ToastQueueContext = createContext<ToastQueueCtx | null>(null);

export function useToastQueue(): ToastQueueCtx {
  const ctx = useContext(ToastQueueContext);
  if (!ctx) {
    throw new Error("useToastQueue must be used within ToastQueueProvider");
  }
  return ctx;
}

function ToastItem({
  entry,
  index,
  onExited,
}: {
  entry: ToastEntry;
  index: number;
  onExited: (id: number) => void;
}) {
  // Kick off exit animation when `entry.visible` flips to false, then
  // notify the parent to drop the entry after the CSS transition ends.
  useEffect(() => {
    if (entry.visible) return;
    const t = setTimeout(() => onExited(entry.id), EXIT_ANIM_MS);
    return () => clearTimeout(t);
  }, [entry.visible, entry.id, onExited]);

  const colors =
    entry.type === "success"
      ? "border-yes/30 bg-yes/10 text-yes"
      : "border-no/30 bg-no/10 text-no";

  // index 0 is newest; stack upward so older toasts sit higher.
  const offsetPx = index * STACK_OFFSET_PX;

  return (
    <div
      role={entry.type === "error" ? "alert" : "status"}
      aria-live={entry.type === "error" ? "assertive" : "polite"}
      style={{ transform: `translateY(-${offsetPx}px)` }}
      className={`fixed bottom-6 right-4 z-[60] max-w-xs px-4 py-3 rounded-lg border backdrop-blur-md transition-all duration-300 ${colors} ${
        entry.visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{entry.type === "success" ? "✓" : "✕"}</span>
        <span className="text-sm font-medium">{entry.message}</span>
      </div>
    </div>
  );
}

export function ToastQueueProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const hide = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: false } : t)),
    );
  }, []);

  const remove = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextIdRef.current++;
      const duration =
        input.duration ??
        (input.type === "error" ? DEFAULT_ERROR_MS : DEFAULT_SUCCESS_MS);
      const entry: ToastEntry = {
        id,
        message: input.message,
        type: input.type,
        duration,
        visible: false,
      };

      setToasts((prev) => {
        // Newest first. Drop oldest when exceeding MAX_TOASTS.
        const next = [entry, ...prev];
        if (next.length > MAX_TOASTS) {
          const dropped = next.slice(MAX_TOASTS);
          for (const d of dropped) clearTimer(d.id);
          return next.slice(0, MAX_TOASTS);
        }
        return next;
      });

      // Trigger enter animation on next frame.
      requestAnimationFrame(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, visible: true } : t)),
        );
      });

      // Schedule auto-dismiss.
      const timer = setTimeout(() => hide(id), duration);
      timersRef.current.set(id, timer);
    },
    [clearTimer, hide],
  );

  // Clear any pending timers on unmount so we don't leak or fire after unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastQueueCtx>(() => ({ push }), [push]);

  return (
    <ToastQueueContext.Provider value={value}>
      {children}
      {toasts.map((entry, i) => (
        <ToastItem
          key={entry.id}
          entry={entry}
          index={i}
          onExited={remove}
        />
      ))}
    </ToastQueueContext.Provider>
  );
}
