import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/current-user";
import { loadAttachmentForDownload } from "@/server/attachments/service";
import { isInlineViewable } from "@/server/attachments/rules";
import { prisma } from "@/server/db";

// Ek indirme ucu (§15.4). Dosyalar web sunucusundan doğrudan servis edilmez;
// her indirme görünürlük modülünden geçer. Faaliyeti görme yetkisi olmayan,
// ekini de indiremez.
//
// Ucun **iki** sunum biçimi var ve ikisi de aynı görünürlük kapısından geçer:
//
//   · varsayılan   → indirme (`attachment`)
//   · `?inline=1`  → sayfada gösterim (`inline`), yalnız resim/PDF/video
//
// Gösterim biçimi istemcinin isteğine bırakılmıyor: tür izin listesinde ve
// gösterilebilir kümesinde değilse istek `inline=1` dese bile dosya indirme
// olarak sunulur. Aksi hâlde tarayıcıda açılmaması gereken bir dosyayı
// açtırmak için tek gereken adres çubuğuna bir parametre eklemek olurdu.

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ danger: "Oturum gerekli." }, { status: 401 });
  }

  const { id } = await params;
  const result = await loadAttachmentForDownload(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    id,
  );

  if (!result.ok) {
    // Yetkisiz erişim ile var olmayan dosya aynı cevabı alır: fark, dosyanın
    // varlığını ele verirdi (§18.4).
    return NextResponse.json({ danger: result.message }, { status: 404 });
  }

  const istenenGosterim = new URL(request.url).searchParams.get("inline") === "1";
  const gosterilebilir = istenenGosterim && isInlineViewable(result.value.mimeType);

  return new NextResponse(new Uint8Array(result.value.content), {
    headers: {
      "Content-Type": result.value.mimeType,
      // Varsayılan indirme: yüklenen dosya tarayıcıda çalıştırılmasın.
      // Gösterim yalnız tarayıcının **çizdiği** türlerde açılıyor.
      "Content-Disposition": `${gosterilebilir ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
        result.value.originalName,
      )}`,
      "X-Content-Type-Options": "nosniff",
      // Gösterilen dosya kendi kaynağını çağıramaz ve betik çalıştıramaz:
      // sandbox tek başına bütün yetenekleri kapatır, `default-src 'none'`
      // ise dosyanın içinden dışarıya istek çıkmasını engeller.
      ...(gosterilebilir
        ? { "Content-Security-Policy": "default-src 'none'; sandbox" }
        : {}),
      "Cache-Control": "private, no-store",
    },
  });
}
