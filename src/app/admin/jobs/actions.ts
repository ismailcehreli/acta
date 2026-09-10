"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/server/authz/admin";
import { requestBackup } from "@/server/backup/requests";
import { prisma } from "@/server/db";

import type { BackupFormState } from "./form-state";

export async function requestBackupAction(
  _previous: BackupFormState,
  _formData: FormData,
): Promise<BackupFormState> {
  void _previous;
  void _formData;

  const me = await requireSystemAdmin();
  const result = await requestBackup(prisma, me.id);

  if (!result.ok) return { error: result.message, success: null };

  revalidatePath("/admin/jobs");
  return {
    error: null,
    success: "Yedek isteği sıraya alındı. Sunucudaki koşucu işlemi başlatacak.",
  };
}
