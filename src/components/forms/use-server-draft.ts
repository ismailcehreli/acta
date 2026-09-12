"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { saveDraftAction } from "@/app/drafts/actions";
import { emptyDraftState } from "@/app/drafts/form-state";


//


//




//


//



const SERVER_DRAFT_SAVE_DELAY_MS = 2000;

export type ServerDraftStatus = "empty" | "saving" | "saved" | "error";

export function useServerDraft(
  formRef: React.RefObject<HTMLFormElement | null>,

  initialDraftId: string | null,

  enabled: boolean,
) {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [status, setStatus] = useState<ServerDraftStatus>("empty");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedSignature = useRef<string>("");
  const cancelled = useRef(false);
  const draftIdRef = useRef<string | null>(initialDraftId);

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  const save = useCallback(async () => {
    const form = formRef.current;
    if (!form || cancelled.current) return;

    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    const files = data
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);


    if (title === "" && description === "") return;


    const signature = JSON.stringify([
      data.get("activityDate"),
      title,
      description,
      data.getAll("targetDepartmentIds"),
      files.map((file) => [file.name, file.size, file.lastModified]),
    ]);
    if (signature === lastSubmittedSignature.current) return;

    const outgoing = new FormData();
    outgoing.set("draftId", draftIdRef.current ?? "");
    outgoing.set("activityDate", String(data.get("activityDate") ?? ""));
    outgoing.set("title", String(data.get("title") ?? ""));
    outgoing.set("description", String(data.get("description") ?? ""));
    for (const id of data.getAll("targetDepartmentIds")) {
      outgoing.append("targetDepartmentIds", String(id));
    }
    if (data.get("openFollowUp") === "on") outgoing.set("openFollowUp", "on");
    for (const file of files) outgoing.append("files", file);

    outgoing.set("savedManually", "0");

    setStatus("saving");

    try {
      const result = await saveDraftAction(emptyDraftState, outgoing);

      if (cancelled.current) return;

      if (result.error) {


        setStatus("error");
        return;
      }

      lastSubmittedSignature.current = signature;
      if (result.draftId) setDraftId(result.draftId);
      setSavedAt(new Date());
      setStatus("saved");
    } catch {
      if (!cancelled.current) setStatus("error");
    }
  }, [formRef]);

  useEffect(() => {
    if (!enabled) return;

    const form = formRef.current;
    if (!form) return;

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SERVER_DRAFT_SAVE_DELAY_MS);
    };

    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);

    return () => {
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, formRef, save]);


  const submitting = useCallback(() => {
    cancelled.current = true;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { draftId, status, savedAt, submitting: submitting };
}
