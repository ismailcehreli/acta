"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { openFollowUp } from "@/server/follow-ups/service";
import { cancelActivity } from "@/server/activities/cancel";
import { createActivity, updateActivity } from "@/server/activities/write";
import type { IncomingFile } from "@/server/attachments/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { readActivityTextLimits } from "@/server/settings/system-settings";
import {
  createActivitySchema,
  updateActivitySchema,
} from "@/shared/schemas/activity";
import { cancelActivitySchema } from "@/shared/schemas/cancel";
import { draftIdSchema } from "@/shared/schemas/draft";

import type { ActivityFormState } from "./form-state";

/** Yazarın kendisi ve biriminin onay bayrağı (§4.3, §5.4). */
async function loadAuthor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const unit = await prisma.orgUnit.findUniqueOrThrow({
    where: { id: user.orgUnitId },
    select: { requiresApproval: true },
  });

  return {
    id: user.id,
    orgUnitId: user.orgUnitId,
    requiresApproval: unit.requiresApproval,
  };
}

/** FormData içindeki ekleri eylem katmanının ortak türüne çevirir. */
async function readIncomingFiles(formData: FormData): Promise<IncomingFile[]> {
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  return Promise.all(
    files.map(async (file) => ({
      originalName: file.name,
      content: Buffer.from(await file.arrayBuffer()),
    })),
  );
}

export async function createActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const author = await loadAuthor();

  const limits = await readActivityTextLimits(prisma);
  const parsed = createActivitySchema(limits).safeParse({
    activityDate: formData.get("activityDate"),
    title: formData.get("title"),
    description: formData.get("description"),
    targetDepartmentIds: formData.getAll("targetDepartmentIds"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz" };
  }

  const rawDraftId = String(formData.get("draftId") ?? "");
  let draftId: string | undefined;
  if (rawDraftId !== "") {
    const draft = draftIdSchema.safeParse({ id: rawDraftId });
    if (!draft.success) return { error: "Taslak bulunamadı." };
    draftId = draft.data.id;
  }

  const now = new Date();
  const files = await readIncomingFiles(formData);
  const result = await createActivity(prisma, author, parsed.data, now, {
    draftId,
    files,
  });

  if (!result.ok) return { error: result.message };

  // "Açık kalsın" işareti (§5.2): tek tık, takip maddesine dönüşür (§11).
  // Faaliyet kaydedildikten **sonra** açılıyor; takip açılamazsa faaliyet yine
  // kaydedilmiş olur ve kullanıcı sebebi görür — sessizce yutulmaz.
  if (formData.get("openFollowUp") === "on") {
    const takip = await openFollowUp(
      prisma,
      { id: author.id, isSystemAdmin: false },
      { activityId: result.activity.id },
      now,
    );

    if (!takip.ok) {
      return {
        error: `Faaliyet kaydedildi ancak takip maddesi açılamadı: ${takip.message}`,
      };
    }
  }

  // Faaliyet gönderildi: kaynağı olan taslak artık gereksiz. Kalırsa
  // kullanıcı gönderilmiş kaydın kopyasını taslaklarında görür ve ikinci kez
  // gönderme riski doğar.
  if (draftId) {
    revalidatePath("/drafts");
  }

  revalidatePath("/activities");
  redirect("/activities?kayit=eklendi");
}

export async function updateActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const author = await loadAuthor();

  const limits = await readActivityTextLimits(prisma);
  const parsed = updateActivitySchema(limits).safeParse({
    id: formData.get("id"),
    activityDate: formData.get("activityDate"),
    title: formData.get("title"),
    description: formData.get("description"),
    targetDepartmentIds: formData.getAll("targetDepartmentIds"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz" };
  }

  const files = await readIncomingFiles(formData);
  const result = await updateActivity(
    prisma,
    author.id,
    parsed.data,
    new Date(),
    { files },
  );

  if (!result.ok) return { error: result.message };

  revalidatePath("/activities");
  redirect("/activities?kayit=duzeltildi");
}

export async function cancelActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = cancelActivitySchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz" };
  }

  const result = await cancelActivity(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.reason,
    new Date(),
  );

  if (!result.ok) return { error: result.message };

  revalidatePath("/activities");
  redirect("/activities?kayit=iptal");
}
