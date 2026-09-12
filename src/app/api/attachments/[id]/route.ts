import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/current-user";
import { loadAttachmentForDownload } from "@/server/attachments/service";
import { isInlineViewable } from "@/server/attachments/rules";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { localizeServiceMessage } from "@/shared/i18n/message";



// Users without visibility cannot download the attachment.
//

//


//





export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) {
    return NextResponse.json(
      { danger: t("errors.api.authenticationRequired") },
      { status: 401 },
    );
  }

  const { id } = await params;
  const result = await loadAttachmentForDownload(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    id,
  );

  if (!result.ok) {


    return NextResponse.json(
      { danger: localizeServiceMessage(t, "attachments", result) },
      { status: 404 },
    );
  }

  const requestedDisplay = new URL(request.url).searchParams.get("inline") === "1";
  const isInlineDisplay = requestedDisplay && isInlineViewable(result.value.mimeType);

  return new NextResponse(new Uint8Array(result.value.content), {
    headers: {
      "Content-Type": result.value.mimeType,


      "Content-Disposition": `${isInlineDisplay ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
        result.value.originalName,
      )}`,
      "X-Content-Type-Options": "nosniff",
      // The displayed file cannot load its own resources or run scripts:
      // the sandbox disables capabilities, while `default-src 'none'` prevents
      // requests from the file to external resources.
      ...(isInlineDisplay
        ? { "Content-Security-Policy": "default-src 'none'; sandbox" }
        : {}),
      "Cache-Control": "private, no-store",
    },
  });
}
