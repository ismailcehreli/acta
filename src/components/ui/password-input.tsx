"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/form";

// Parola girdisi + görünürlük anahtarı (brief §7).
//
// Anahtar **hover'a saklanmaz** (§3): her zaman görünür ve 44px dokunma
// hedefine sahiptir. Durumu ekran okuyucuya `aria-pressed` ile bildirir;
// ikon tek başına anlam taşımaz, `aria-label` metni de değişir.
//
// Parola yöneticileri ve autofill çalışmaya devam eder: alan tipi
// `password`/`text` arasında değişse de `name` ve `autoComplete` sabittir.

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
  const [acik, setAcik] = useState(false);
  const durumId = useId();

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={acik ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
        aria-describedby={[describedBy, durumId].filter(Boolean).join(" ")}
        className="pe-12"
      />

      <button
        type="button"
        onClick={() => setAcik((onceki) => !onceki)}
        aria-pressed={acik}
        aria-label={acik ? "Parolayı gizle" : "Parolayı göster"}
        className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted hover:text-ink"
      >
        {acik ? (
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

      {/* Durum değişimi ekran okuyucuya duyurulur; ikon sessiz kalmaz. */}
      <span id={durumId} className="sr-only" role="status">
        {acik ? "Parola görünür durumda." : "Parola gizli."}
      </span>
    </div>
  );
}
