"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  differsFromCurrent,
  hasContent,
  parseDraft,
  type ActivityDraft,
  type DraftFields,
} from "@/shared/drafts/activity-draft";


//


//





const LOCAL_DRAFT_SAVE_DELAY_MS = 500;

function storage(): Storage | null {
  try {


    return window.localStorage;
  } catch {
    return null;
  }
}

function readForm(form: HTMLFormElement): DraftFields {
  const data = new FormData(form);

  return {
    activityDate: String(data.get("activityDate") ?? ""),
    title: String(data.get("title") ?? ""),
    description: String(data.get("description") ?? ""),
    targetDepartmentIds: data
      .getAll("targetDepartmentIds")
      .map((value) => String(value)),
  };
}

function writeForm(form: HTMLFormElement, draft: ActivityDraft): void {
  const field = <T extends HTMLElement>(name: string) =>
    form.elements.namedItem(name) as T | null;

  const date = field<HTMLInputElement>("activityDate");
  if (date) date.value = draft.activityDate;

  const title = field<HTMLInputElement>("title");
  if (title) title.value = draft.title;

  const description = field<HTMLTextAreaElement>("description");
  if (description) description.value = draft.description;

}

export interface DraftControl {
  formRef: React.RefObject<HTMLFormElement | null>;
  /** A draft waiting to be restored, or `null`. */
  pending: ActivityDraft | null;
  restore: () => void;
  discard: () => void;
  /** Called when the form is submitted; clears the draft to avoid duplicates. */
  submitted: () => void;
}

export function useActivityDraft(
  storageKey: string,
  current: DraftFields,

  onDepartmentsRestored: (ids: string[]) => void,
): DraftControl {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [pending, setPending] = useState<ActivityDraft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);


  useEffect(() => {
    const store = storage();
    if (!store) return;

    const draft = parseDraft(store.getItem(storageKey));
    if (!draft) return;

    if (!hasContent(draft) || !differsFromCurrent(draft, current)) {
      store.removeItem(storageKey);
      return;
    }





    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(draft);


    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);


  useEffect(() => {
    const form = formRef.current;
    const store = storage();
    if (!form || !store) return;

    const save = () => {
      const fields = readForm(form);

      if (!hasContent(fields)) {
        store.removeItem(storageKey);
        return;
      }

      store.setItem(
        storageKey,
        JSON.stringify({ ...fields, savedAt: new Date().toISOString() }),
      );
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, LOCAL_DRAFT_SAVE_DELAY_MS);
    };

    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);


    window.addEventListener("pagehide", save);

    return () => {
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
      window.removeEventListener("pagehide", save);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [storageKey]);

  const restore = useCallback(() => {
    const form = formRef.current;
    if (!form || !pending) return;

    writeForm(form, pending);
    onDepartmentsRestored(pending.targetDepartmentIds);
    setPending(null);
  }, [pending, onDepartmentsRestored]);

  const discard = useCallback(() => {
    storage()?.removeItem(storageKey);
    setPending(null);
  }, [storageKey]);

  const submitted = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    storage()?.removeItem(storageKey);
    setPending(null);
  }, [storageKey]);

  return { formRef, pending, restore, discard, submitted };
}
