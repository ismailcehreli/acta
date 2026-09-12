"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { DEMO_DEFAULT_PASSWORD, installDemoData } from "@/server/demo/data";
import { classifyLegacyDemoOrgUnits } from "@/server/demo/origin";
import { purgeDemoData } from "@/server/demo/purge";
import {
  generateVapidKeys,
  readVapidView,
  saveVapidSubject,
} from "@/server/settings/vapid";
import {
  DEFAULT_FOOTER_TEXT,
  DEFAULT_PAGE_TITLE,
  removeLogo,
  saveBrandingTexts,
  saveLogo,
} from "@/server/settings/branding";
import { SETTING_DEFINITIONS } from "@/server/settings/registry";
import {
  clearSmtpPassword,
  readSmtpSettings,
  saveSmtpSettings,
} from "@/server/settings/smtp";
import { saveSettings } from "@/server/settings/system-settings";
import { smtpSettingsSchema, testEmailSchema } from "@/shared/schemas/settings";
import { classifyLegacyDemoOriginsSchema } from "@/shared/schemas/demo";
import { createSmtpTransport } from "@/worker/notifications/transport";
import { getTranslations } from "@/server/i18n/server";
import type { TranslateFunction } from "@/shared/i18n";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";

import { findSettingsSection } from "./settings-sections";
import type { SettingsFormState } from "./form-state";




export async function saveSettingsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const sectionSlug = String(formData.get("section") ?? "");
  const section = findSettingsSection(sectionSlug);
  if (!section || section.groups.length === 0) {
    return { error: t("screens.settingsPage.actions.sectionNotFound"), success: null };
  }

  const values: Record<string, string> = {};

  for (const definition of SETTING_DEFINITIONS.filter((item) =>
    section.groups.some((group) => group === item.group),
  )) {
    if (definition.type === "boolean") {

      values[definition.key] = formData.get(definition.key) === "on" ? "true" : "false";
      continue;
    }

    const raw = formData.get(definition.key);
    if (typeof raw !== "string") continue;
    values[definition.key] = raw;
  }

  const result = await saveSettings(prisma, values, me.id);
  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "settings", result),
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");

  return {
    error: null,
    success:
      result.changed.length === 0
        ? t("screens.settingsPage.actions.noChanges")
        : t("screens.settingsPage.actions.settingsUpdated", {
            count: result.changed.length,
          }),
  };
}

export async function saveSmtpAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const rawPassword = formData.get("password");
  const parsed = smtpSettingsSchema.safeParse({
    host: formData.get("host"),
    port: formData.get("port"),
    secure: formData.get("secure") === "on",
    user: formData.get("user") ?? "",
    // An empty password means "keep the current value", not "delete it".
    password: typeof rawPassword === "string" && rawPassword !== "" ? rawPassword : undefined,
    from: formData.get("from"),
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
    };
  }

  await saveSmtpSettings(prisma, parsed.data, undefined, me.id);
  revalidatePath("/admin/settings", "layout");

  return {
    error: null,
    success: t("screens.settingsPage.actions.smtpSaved"),
  };
}

export async function clearSmtpPasswordAction(): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  await clearSmtpPassword(prisma, me.id);
  revalidatePath("/admin/settings", "layout");

  return { error: null, success: t("screens.settingsPage.actions.smtpPasswordDeleted") };
}

/**
 * Test email. Settings must be verified without waiting for a notification to
 * accumulate silently because of a wrong server address (§12.4).
 */
export async function sendTestEmailAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = testEmailSchema.safeParse({ to: formData.get("to") });
  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
    };
  }

  const settings = await readSmtpSettings(prisma);
  if (!settings) {
    return {
      error: t("screens.settingsPage.actions.smtpIncomplete"),
      success: null,
    };
  }

  try {
    const transport = createSmtpTransport(settings);
    await transport.send({
      to: parsed.data.to,
      subject: t("screens.settingsPage.actions.testEmailSubject"),
      text: t("screens.settingsPage.actions.testEmailBody"),
    });
  } catch (error) {
    // Do not swallow errors: IT support needs to know what failed. Keep the raw
    // Raw Node errors often omit the next step, so translate known failures into
    // actionable guidance.
    const message = error instanceof Error ? error.message : String(error);
    return { error: translateSmtpError(message, settings.host, t), success: null };
  }

  return {
    error: null,
    success: t("screens.settingsPage.actions.testEmailSent", {
      address: parsed.data.to,
    }),
  };
}

/**
 * Translate known SMTP failures into actionable messages.
 *
 * The raw error text is also preserved: when a failure cannot be translated, IT support
 * still needs to see the original. Silently saying "could not send" would hide
 * the failure.
 */
function translateSmtpError(
  message: string,
  host: string,
  t: TranslateFunction,
): string {
  // The certificate says the server name belongs to another domain.
  // The most common cause is a mistyped server address.
  const subName = message.match(/is not in the cert's altnames:\s*(.+)$/);
  if (message.includes("does not match certificate") && subName) {
    const validAddresses = [...subName[1].matchAll(/DNS:([^\s,]+)/g)]
      .map((match) => match[1])
      .filter((name) => !name.startsWith("*."));

    const suggestion =
      validAddresses.length > 0
        ? t("screens.settingsPage.actions.smtpCertificateSuggestion", {
            addresses: validAddresses.join(", "),
          })
        : "";

    return t("screens.settingsPage.actions.smtpCertificateMismatch", {
      host,
      suggestion,
      message,
    });
  }

  if (message.includes("Invalid login") || message.includes("535")) {
    return t("screens.settingsPage.actions.smtpCredentialsRejected", { message });
  }

  if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
    return t("screens.settingsPage.actions.smtpConnectionFailed", {
      host,
      message,
    });
  }

  return t("screens.settingsPage.actions.smtpSendFailed", { message });
}

export async function saveBrandingAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  // Neither field is required: an empty value falls back to the default. The
  // tab title and footer appear on every page, so a value must always exist.
  const title = String(formData.get("pageTitle") ?? "").trim();
  const subStrip = String(formData.get("footerText") ?? "").trim();

  if (title.length > 100) {
    return { error: t("screens.settingsPage.actions.pageTitleTooLong"), success: null };
  }
  if (subStrip.length > 200) {
    return { error: t("screens.settingsPage.actions.footerTooLong"), success: null };
  }

  await saveBrandingTexts(
    prisma,
    {
      pageTitle: title || DEFAULT_PAGE_TITLE,
      footerText: subStrip || DEFAULT_FOOTER_TEXT,
    },
    me.id,
  );

  const file = formData.get("logo");
  if (file instanceof File && file.size > 0) {
    const result = await saveLogo(
      prisma,
      { type: file.type, content: Buffer.from(await file.arrayBuffer()) },
      me.id,
    );

    if (!result.ok) {
      return {
        error: localizeServiceMessage(t, "branding", result),
        success: null,
      };
    }
  }

  revalidatePath("/", "layout");

  return { error: null, success: t("screens.settingsPage.actions.customizationSaved") };
}

export async function removeLogoAction(): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  await removeLogo(prisma, me.id);
  revalidatePath("/", "layout");

  return { error: null, success: t("screens.settingsPage.actions.logoRemoved") };
}


/**
 * Browser notification setup (Task 5.3b).
 *
 * **Two separate operations stay separate:** changing the contact address is
 * harmless, while rotating keys invalidates every subscription. Previously both
 * used the same path, making address changes impossible because the code rejected
 * them when a key already existed (21.08.2026, reported by the product owner).
 */
export async function saveVapidAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();
  const subject = String(formData.get("subject") ?? "");

  // On an installed system, "Save" changes only the contact address.
  const currentVapid = await readVapidView(prisma);
  if (currentVapid.configured && formData.get("replace") !== "on") {
    const address = await saveVapidSubject(prisma, subject, me.id);

    if (!address.ok) {
      return {
        error: localizeServiceMessage(t, "push", address),
        success: null,
      };
    }

    revalidatePath("/admin/settings", "layout");
    return { error: null, success: t("screens.settingsPage.actions.contactSaved") };
  }

  const result = await generateVapidKeys(
    prisma,
    {
      subject,
      replace: formData.get("replace") === "on",
    },
    me.id,
  );

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "push", result),
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");

  return {
    error: null,
    success: result.replaced
      ? t("screens.settingsPage.actions.vapidKeysReplaced")
      : t("screens.settingsPage.actions.vapidKeysGenerated"),
  };
}

// ── Demo data ────────────────────────────────────────────────────────
//
// An empty system cannot demonstrate whether the screens work. These two actions
// install a sample company covering the application's features and can clean it up.
//
// **Deletion is a narrow exception to the project's "no physical deletion" rule**
// (product-owner decision, 20.08.2026) and touches only rows marked with
// `@example.test`. If real data references a demo record, the foreign key rejects
// the operation and nothing is deleted.

export async function installDemoAction(): Promise<SettingsFormState> {
  await requireSystemAdmin();
  const t = await getTranslations();

  const result = await installDemoData(prisma, {
    password: process.env.DEMO_PASSWORD ?? DEMO_DEFAULT_PASSWORD,
  });

  if (!result.ok) {
    return {
      error: t("screens.settingsPage.actions.demoNoRoot"),
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");
  return {
    error: null,
    success: t("screens.settingsPage.actions.demoInstalled", {
      password: process.env.DEMO_PASSWORD ?? DEMO_DEFAULT_PASSWORD,
    }),
  };
}

export async function purgeDemoAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  // Require typed confirmation; one click must not trigger irreversible cleanup.
  const confirmation = String(formData.get("confirmation") ?? "").trim();
  const upper = confirmation.toUpperCase();
  if (upper !== "DELETE") {
    return {
      error: t("screens.settingsPage.actions.deleteConfirmation"),
      success: null,
    };
  }

  const result = await purgeDemoData(prisma, me.id);

  if (!result.ok && result.error === "nothing_to_purge") {
    return { error: t("screens.settingsPage.actions.noDemoData"), success: null };
  }

  if (!result.ok && result.error === "legacy_demo_origin_unknown") {
    return {
      error: t("screens.settingsPage.actions.legacyOriginUnknown"),
      success: null,
    };
  }

  if (!result.ok) {
    console.error("[demo data] Purge blocked:", result.detail);
    return {
      error: t("screens.settingsPage.actions.demoPurgeBlocked", {
        detail: result.detail,
      }),
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");
  const o = result.summary;
  return {
    error: null,
    success: t("screens.settingsPage.actions.demoPurged", {
      users: o.users,
      activities: o.activities,
      conversations: o.conversations,
      followUps: o.followUps,
      helpArticles: o.helpArticles,
      notifications: o.notifications,
      orgUnits: o.orgUnits,
      files: o.files,
    }),
  };
}

export async function classifyLegacyDemoOriginsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const ids = formData
    .getAll("orgUnitId")
    .filter((value): value is string => typeof value === "string");
  const parsed = classifyLegacyDemoOriginsSchema.safeParse({
    selections: ids.map((orgUnitId) => ({
      orgUnitId,
      origin: formData.get(`origin:${orgUnitId}`),
    })),
  });
  if (!parsed.success) {
    return {
      error:
        localizeValidationIssue(
          t,
          parsed.error.issues[0],
          "screens.settingsPage.actions.selectOriginEveryUnit",
        ),
      success: null,
    };
  }

  const result = await classifyLegacyDemoOrgUnits(
    prisma,
    me.id,
    parsed.data.selections,
  );
  if (!result.ok) {
    return {
      error:
        result.error === "candidate_set_changed"
          ? t("screens.settingsPage.actions.candidateSetChanged")
          : t("screens.settingsPage.actions.invalidOrigin"),
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");
  return {
    error: null,
    success: t("screens.settingsPage.actions.originsSaved", {
      count: result.classified,
    }),
  };
}
