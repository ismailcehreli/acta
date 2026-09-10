import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import { loadLogo } from "@/server/settings/branding";

// Logo servisi. Oturum istemez: logo giriş ekranında da görünür ve gizli bir
// veri değildir. Dosya diskten okunur, web sunucusundan doğrudan servis
// edilmez (§15.4 ile aynı yaklaşım).

export const dynamic = "force-dynamic";

export async function GET() {
  const logo = await loadLogo(prisma);

  if (!logo) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(logo.content), {
    headers: {
      "Content-Type": logo.contentType,
      // Adres uzantıyı taşıdığı için logo değişince adres de değişir.
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
