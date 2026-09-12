"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";


//




function isFormFieldFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;

  const tagName = active.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    (active as HTMLElement).isContentEditable === true
  );
}


const DEBOUNCE_MS = 300;

export function LiveRefresh() {
  const router = useRouter();

  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);


  const routerRef = useRef(router);



  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const refresh = () => {
      if (isFormFieldFocused()) {

        pending.current = true;
        return;
      }

      pending.current = false;
      routerRef.current.refresh();
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, DEBOUNCE_MS);
    };

    const handleFocusLeave = () => {
      if (!pending.current) return;

      setTimeout(() => {
        if (pending.current && !isFormFieldFocused()) refresh();
      }, 0);
    };

    const source = new EventSource("/api/events");
    source.onmessage = schedule;

    for (const type of [
      "activity_created",
      "question_asked",
      "answer_received",
      "conversation_closed",
      "activity_cancelled",
      "approval_pending",
      "approval_decided",
      "reconnected",
    ]) {
      source.addEventListener(type, schedule);
    }



    document.addEventListener("focusout", handleFocusLeave);

    return () => {
      document.removeEventListener("focusout", handleFocusLeave);
      if (timer.current) clearTimeout(timer.current);
      source.close();
    };

  }, []);

  return null;
}
