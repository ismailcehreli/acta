"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import type { TargetOption } from "@/server/activities/target-options";

// İlgili departman seçici (Görev 10.3).
//
// Eskiden bütün departmanlar alt alta kutucuktu. Yirmi beş departmanlı bir
// şirkette bu, telefonda ekranı dolduran ve kaydırılması gereken bir duvar —
// 30 saniyelik giriş hedefini (§18.4) tam da burada kırıyordu.
//
// Sıralama **değişmedi**: kişinin kendi birimi ve alt birimleri üstte, diğerleri
// altta (§5.3). Kişiye özel "sık kullandıklarınız" bilerek yok; ürün sahibi
// mevcut mantıkla devam edilmesini istedi.

/** Türkçe'ye duyarlı karşılaştırma: "I/ı" ve "İ/i" ayrımı doğru çalışsın. */
function kucult(metin: string): string {
  return metin.toLocaleLowerCase("tr-TR");
}

function Kutucuk({
  option,
  checked,
  disabled,
  onToggle,
}: {
  option: TargetOption;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label
      className={[
        "flex items-center gap-2.5 rounded-(--radius-sm) px-2 py-1.5 text-[length:var(--text-sm)]",
        disabled ? "cursor-not-allowed opacity-45" : "hover:bg-surface-hover",
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(option.id)}
        className="size-4 rounded border-line-strong text-primary"
      />
      <span className="text-ink">{option.name}</span>
      {option.own ? (
        <span className="text-[length:var(--text-xs)] text-muted">
          (kendi biriminiz)
        </span>
      ) : null}
    </label>
  );
}

export function DepartmentPicker({
  options,
  selected,
  onChange,
  max,
}: {
  options: TargetOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
}) {
  const [arama, setArama] = useState("");

  const secilenKume = useMemo(() => new Set(selected), [selected]);

  const secilenler = useMemo(
    () =>
      selected
        .map((id) => options.find((option) => option.id === id))
        .filter((option): option is TargetOption => option !== undefined),
    [selected, options],
  );

  const suzulmus = useMemo(() => {
    const anahtar = kucult(arama.trim());
    if (anahtar === "") return options;
    return options.filter((option) => kucult(option.name).includes(anahtar));
  }, [arama, options]);

  const dolu = selected.length >= max;

  function degistir(id: string) {
    if (secilenKume.has(id)) {
      onChange(selected.filter((secili) => secili !== id));
      return;
    }
    // Sınıra gelindiğinde sessizce yutmak yerine kutucuk zaten kapalı olur;
    // buraya yine de bakılıyor çünkü klavyeyle tetiklenebilir.
    if (dolu) return;
    onChange([...selected, id]);
  }

  const kendi = suzulmus.filter((option) => option.own);
  const digerleri = suzulmus.filter((option) => !option.own);

  return (
    <div className="flex flex-col gap-2.5" data-test="departman-secici">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={arama}
          onChange={(olay) => setArama(olay.target.value)}
          placeholder="Departman ara…"
          aria-label="Departman ara"
          className="w-full sm:w-64"
        />
        <span className="text-[length:var(--text-xs)] text-muted tabular">
          {selected.length}/{max}
        </span>
      </div>

      {/* Seçilenler üstte: kaç tane seçtiğini görmek için listeyi baştan sona
          taramak gerekmiyor. */}
      {secilenler.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-test="secilen-departmanlar">
          {secilenler.map((option) => (
            <Badge key={option.id} tone="primary">
              {option.name}
              <button
                type="button"
                onClick={() => degistir(option.id)}
                aria-label={`${option.name} seçimini kaldır`}
                className="-mr-0.5 ml-0.5 rounded-full px-1 leading-none hover:bg-primary-line"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {suzulmus.length === 0 ? (
        <p className="px-2 py-3 text-[length:var(--text-sm)] text-muted">
          &quot;{arama}&quot; ile eşleşen departman yok.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {kendi.length > 0 ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {kendi.map((option) => (
                <Kutucuk
                  key={option.id}
                  option={option}
                  checked={secilenKume.has(option.id)}
                  disabled={dolu && !secilenKume.has(option.id)}
                  onToggle={degistir}
                />
              ))}
            </div>
          ) : null}

          {kendi.length > 0 && digerleri.length > 0 ? (
            <hr className="border-line" />
          ) : null}

          {digerleri.length > 0 ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {digerleri.map((option) => (
                <Kutucuk
                  key={option.id}
                  option={option}
                  checked={secilenKume.has(option.id)}
                  disabled={dolu && !secilenKume.has(option.id)}
                  onToggle={degistir}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {dolu ? (
        <p className="text-[length:var(--text-xs)] text-muted">
          En fazla {max} departman seçilebilir. Yenisini eklemek için birini
          kaldırın.
        </p>
      ) : null}

      {/* Forma giden değer. Kutucuklar denetimli olduğu için asıl gönderim
          buradan yapılır; sunucu tarafı hiç değişmedi. */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="targetDepartmentIds" value={id} />
      ))}
    </div>
  );
}
