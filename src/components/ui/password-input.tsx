"use client";

import { useId, useState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Input } from "@/components/ui/form";


export function PasswordInput({
  id,
  name,
  autoComplete,
  required,
  autoFocus,
  describedBy,
}: {
  id: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations();
  const [isVisible, setIsVisible] = useState(false);
  const statusId = useId();

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={isVisible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
        aria-describedby={[describedBy, statusId].filter(Boolean).join(" ")}
        className="pe-12"
      />

      <button
        type="button"
        onClick={() => setIsVisible((previous) => !previous)}
        aria-pressed={isVisible}
        aria-label={isVisible ? t("auth.hidePassword") : t("auth.showPassword")}
        className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted hover:text-ink"
      >
        {isVisible ? (
          <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3 3l14 14" strokeLinecap="square" />
            <path d="M7.3 7.4A2.8 2.8 0 0 0 10 12.8c.7 0 1.4-.3 1.9-.7" />
            <path d="M5.2 5.7C3.4 6.9 2.2 8.6 1.8 10c.8 2.4 4 5 8.2 5 1.3 0 2.5-.3 3.5-.7M8.6 5.2c.5-.1.9-.2 1.4-.2 4.2 0 7.4 2.6 8.2 5-.3 1-.9 2-1.9 2.9" />
          </svg>
        ) : (
          <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M1.8 10C2.6 7.6 5.8 5 10 5s7.4 2.6 8.2 5c-.8 2.4-4 5-8.2 5s-7.4-2.6-8.2-5Z" />
            <circle cx="10" cy="10" r="2.6" />
          </svg>
        )}
      </button>


      <span id={statusId} className="sr-only" role="status">
        {isVisible ? t("auth.passwordVisible") : t("auth.passwordHidden")}
      </span>
    </div>
  );
}
