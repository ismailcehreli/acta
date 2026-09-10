"use client";

import { useActionState, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";

import { removeAvatarAction, uploadAvatarAction } from "./avatar-actions";
import { emptyAvatarState } from "./form-state";

// Profil resmi yükleme (Görev 11.5).
//
// **Küçültme tarayıcıda yapılıyor.** Sunucuda küçültmek yeni bir yerel
// bağımlılık (sharp) gerektirirdi ve bu ayrı bir karardır. Telefondan gelen
// 4 MB'lık bir fotoğraf burada 256×256 WebP'ye iniyor — tipik 20–40 KB.
//
// Bu bir **kolaylık**, güvenlik değil: sunucu türü içerik imzasından
// doğruluyor ve 512 KB sınırını kendisi uyguluyor. Küçültmeyi atlatan bir
// istek sınıra takılır.

const HEDEF = 256;

/** Resmi kareye kırpıp `HEDEF` boyuta indirir; başarısızsa özgün dosyayı verir. */
async function kucult(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    // Kısa kenardan kare kırpma: yüz genelde ortadadır, kenarlardan kırpmak
    // baştaki ya da sondaki bilgiyi atar.
    const kenar = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - kenar) / 2;
    const sy = (bitmap.height - kenar) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = HEDEF;
    canvas.height = HEDEF;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, sx, sy, kenar, kenar, 0, 0, HEDEF, HEDEF);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!blob) return file;

    return new File([blob], "avatar.webp", { type: "image/webp" });
  } catch {
    // Tarayıcı desteklemiyorsa ya da dosya bozuksa özgün hâli gönderilir;
    // kararı sunucu verir.
    return file;
  }
}

export function AvatarForm({
  user,
  canEdit,
}: {
  user: { id: string; fullName: string; avatarExtension: string | null };
  /** Kişinin kendisi ya da sistem yöneticisi. */
  canEdit: boolean;
}) {
  const [yukleme, yukle, yukleniyor] = useActionState(
    uploadAvatarAction,
    emptyAvatarState,
  );
  const [kaldirma, kaldir, kaldiriliyor] = useActionState(
    removeAvatarAction,
    emptyAvatarState,
  );
  const [onizleme, setOnizleme] = useState<string | null>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);

  // İki ayrı eylem durumu var ve ikisi de kendi sonucunu tutuyor. "Hangisi
  // önce yazılırsa o kazanır" diye birleştirmek yanlıştı: yükledikten sonra
  // resmi kaldıran kullanıcı hâlâ "profil resmi güncellendi" yazısını
  // okuyordu. Damgası büyük olan, yani **son yapılan işlem** geçerli.
  const sonIslem =
    (kaldirma.stamp ?? 0) > (yukleme.stamp ?? 0) ? kaldirma : yukleme;

  // Ekranda gösterilecek uzantı **son işlemin sonucundan** geliyor; sunucudan
  // gelen prop yalnız ilk hâli veriyor.
  //
  // Sebep: `revalidatePath` "stale-while-revalidate" çalışıyor (Next belgesi,
  // 09-revalidating). Kullanıcı kendi yazdığını hemen görmüyordu — "profil
  // resmi güncellendi" yazısını okuyup eski resme bakıyordu.
  const uzanti =
    sonIslem.extension !== undefined ? sonIslem.extension : user.avatarExtension;

  const damga = sonIslem.stamp;
  const gosterilen = { ...user, avatarExtension: uzanti };

  const durum = yukleme.error ?? kaldirma.error ?? null;
  const basari = sonIslem.success;

  if (!canEdit) {
    return <Avatar user={user} size={96} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {/* İşlem bitince önizleme bırakılır: artık sunucudaki **gerçek**
            resim gösterilmeli. Önizleme kalsaydı kullanıcı yüklediğinin
            değil, seçtiğinin görüntüsüne bakardı. */}
        {onizleme && !damga ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={onizleme}
            alt=""
            aria-hidden
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-full object-cover"
          />
        ) : (
          <Avatar
            user={gosterilen}
            size={96}
            cacheKey={damga ? String(damga) : undefined}
          />
        )}

        <div className="flex flex-col gap-2">
          <form
            action={async (formData) => {
              const secilen = dosyaRef.current?.files?.[0];
              if (secilen) formData.set("avatar", await kucult(secilen));
              yukle(formData);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="userId" value={user.id} />
            <input
              ref={dosyaRef}
              type="file"
              name="avatar"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Profil resmi dosyası"
              className="text-[length:var(--text-sm)] text-muted file:me-3 file:rounded-(--radius-sm) file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[length:var(--text-sm)] file:text-ink"
              onChange={(event) => {
                const secilen = event.target.files?.[0];
                setOnizleme(secilen ? URL.createObjectURL(secilen) : null);
              }}
            />
            <Button type="submit" size="sm" disabled={yukleniyor}>
              {yukleniyor ? "Yükleniyor…" : "Yükle"}
            </Button>
          </form>

          {uzanti ? (
            <form action={kaldir}>
              <input type="hidden" name="userId" value={user.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={kaldiriliyor}
              >
                {kaldiriliyor ? "Kaldırılıyor…" : "Resmi kaldır"}
              </Button>
            </form>
          ) : null}

          <p className="text-[length:var(--text-2xs)] text-faint">
            PNG, JPEG ya da WebP · en fazla 512 KB. Resim tarayıcınızda
            256×256 boyutuna küçültülerek gönderilir.
          </p>
        </div>
      </div>

      {durum ? <Alert tone="danger">{durum}</Alert> : null}
      {basari ? <Alert tone="success">{basari}</Alert> : null}
    </div>
  );
}
