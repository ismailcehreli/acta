import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { resolveProfileAccess } from "@/server/users/profile";
import { readAvatar } from "@/server/users/avatar";

// Profil resmi servisi (Görev 11.5).
//
// Dosyalar web sunucusundan **doğrudan servis edilmez** (§15.4): istek buradan
// geçer ve yetki kontrolü yapılır. Aksi hâlde `storage/avatars/<uuid>.png`
// adresini bilen herkes resmi indirebilirdi.
//
// **Yetki kararı profil ekranıyla aynı yerden gelir** (`loadProfile`). Ayrı bir
// kural yazmak, ikisinin ayrışması demekti: profilde 404 dönen bir kişinin
// resmi buradan sızabilirdi.
//
// Görülemeyen kişi için **404** döner, 403 değil: "var ama göremezsin" demek
// kişinin varlığını ele verirdi (profil ekranındaki aynı ilke).

// Rota **dinamik**: `cookies()` ile oturum okunuyor ve statik değerlendirme
// çerezi hiç görmez — ilk yazımda bu unutuldu ve uç nokta oturumu olan
// kullanıcıya da 404 döndü. Projedeki her API rotasında aynı satır var.
export const dynamic = "force-dynamic";

const TURLER: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getCurrentUser();
  if (!viewer) return new NextResponse(null, { status: 404 });

  const { id } = await params;

  // Üst veri seviyesi de yeter: resim içerik değil, kimliğin bir parçasıdır
  // ve profil ekranında da o seviyede gösterilir.
  //
  // **Hafif** karar kullanılıyor. Önce `loadProfile` çağrılıyordu; o, erişim
  // kararının yanında dört sayım sorgusu daha koşuyor. Liste ekranında 25
  // avatar demek 25 ağır sorgu demekti ve uçtan uca koşuda sayfa yüklemeleri
  // dakikalara çıktı.
  const erisim = await resolveProfileAccess(
    prisma,
    { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin },
    id,
  );
  if (erisim === "none") return new NextResponse(null, { status: 404 });

  const kisi = await prisma.user.findUnique({
    where: { id },
    select: { avatarExtension: true },
  });
  const uzanti = kisi?.avatarExtension;
  if (!uzanti) return new NextResponse(null, { status: 404 });

  const icerik = await readAvatar(id, uzanti);
  if (!icerik) return new NextResponse(null, { status: 404 });

  // **Adres resim değişince değişmiyor**: aynı kişi, aynı uzantı. Süreli
  // önbellek (`max-age=3600`) bu yüzden yanlıştı — resmini değiştiren
  // kullanıcı bir saat boyunca eskisini görürdü.
  //
  // Doğrusu koşullu istek: tarayıcı her seferinde soruyor ama içerik
  // değişmediyse gövde inmiyor (304). Etiket içerikten türetiliyor.
  const etag = `"${createHash("sha256").update(icerik).digest("hex").slice(0, 32)}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(icerik), {
    headers: {
      "Content-Type": TURLER[uzanti] ?? "application/octet-stream",
      // `private`: paylaşılan bir vekilde başkasının resmi saklanmamalı.
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "Content-Length": String(icerik.byteLength),
    },
  });
}
