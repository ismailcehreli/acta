import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import { loadLogo } from "@/server/settings/branding";





export const dynamic = "force-dynamic";

export async function GET() {
  const logo = await loadLogo(prisma);

  if (!logo) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(logo.content), {
    headers: {
      "Content-Type": logo.contentType,

      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
