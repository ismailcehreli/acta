"use client";

import { useEffect, useRef } from "react";

import { markReadAction } from "./read-actions";


export function ReadTracker({
  activityId,
  ticket,
  dwellMs,
}: {
  activityId: string;
  ticket: string;
  dwellMs: number;
}) {
  const initialTicket = useRef(ticket);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reported = false;

    function stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }

    function start() {
      if (reported || timer !== undefined) return;
      timer = setTimeout(() => {
        reported = true;
        void markReadAction(activityId, initialTicket.current).catch((error: unknown) => {
          console.error("Could not submit the activity read event.", error);
        });
      }, dwellMs);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", stop);
    window.addEventListener("focus", start);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", start);
    };
  }, [activityId, dwellMs]);

  return null;
}
