"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  recordReadFromTicket,
  type MarkReadResult,
} from "@/server/reads/service";
import { readTicketSubmissionSchema } from "@/shared/schemas/read";


export async function markReadAction(
  activityId: string,
  ticket: string,
): Promise<MarkReadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: "invalid_ticket" };

  const parsed = readTicketSubmissionSchema.safeParse({ activityId, ticket });
  if (!parsed.success) return { ok: false, reason: "invalid_ticket" };

  const result = await recordReadFromTicket(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.activityId,
    parsed.data.ticket,
    new Date(),
  );

  if (result.ok && result.recorded) {
    revalidatePath(`/activities/${parsed.data.activityId}`);
    revalidatePath("/");
    revalidatePath("/feed");
  }

  return result;
}
