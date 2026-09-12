import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { resolveProfileAccess } from "@/server/users/profile";
import { readAvatar } from "@/server/users/avatar";


//


// The endpoint is protected so knowing the URL alone does not reveal an avatar.
//



//






export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
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



  //




  const access = await resolveProfileAccess(
    prisma,
    { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin },
    id,
  );
  if (access === "none") return new NextResponse(null, { status: 404 });

  const person = await prisma.user.findUnique({
    where: { id },
    select: { avatarExtension: true },
  });
  const extension = person?.avatarExtension;
  if (!extension) return new NextResponse(null, { status: 404 });

  const content = await readAvatar(id, extension);
  if (!content) return new NextResponse(null, { status: 404 });




  //


  const etag = `"${createHash("sha256").update(content).digest("hex").slice(0, 32)}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",

      "Cache-Control": "private, no-cache",
      ETag: etag,
      "Content-Length": String(content.byteLength),
    },
  });
}
