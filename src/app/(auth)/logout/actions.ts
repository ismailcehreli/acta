"use server";

import { redirect } from "next/navigation";

import { clearSessionCookie, readSessionCookie } from "@/server/auth/cookies";
import { revokeSession } from "@/server/auth/session";
import { prisma } from "@/server/db";

export async function logoutAction(): Promise<void> {
  const token = await readSessionCookie();

  if (token) {


    await revokeSession(prisma, token, new Date());
  }

  await clearSessionCookie();
  redirect("/login");
}
