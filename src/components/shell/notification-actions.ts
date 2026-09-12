"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { markInboxSeen } from "@/server/notifications/inbox";


//




export async function markNotificationsSeenAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await markInboxSeen(prisma, user.id);
  revalidatePath("/", "layout");
}
