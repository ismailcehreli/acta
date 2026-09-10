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

import { findSettingsSection } from "./settings-sections";
import type { SettingsFormState } from "./form-state";

// Ayar değişikliği yalnız sistem yöneticisinindir (§15.1). Ekranın gizlenmesi
// güvenlik değildir; asıl kontrol burada.

export async function saveSettingsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();

  const sectionSlug = String(formData.get("section") ?? "");
  const section = findSettingsSection(sectionSlug);
  if (!section || section.groups.length === 0) {
    return { error: "Ayar bölümü bulunamadı.", success: null };
  }

  const values: Record<string, string> = {};

  for (const definition of SETTING_DEFINITIONS.filter((item) =>
    section.groups.some((group) => group === item.group),
  )) {
    if (definition.type === "boolean") {
      // İşaretlenmemiş kutu form verisinde hiç yer almaz; "kapalı" demektir.
      values[definition.key] = formData.get(definition.key) === "on" ? "true" : "false";
      continue;
    }

    const raw = formData.get(definition.key);
    if (typeof raw !== "string") continue;
    values[definition.key] = raw;
  }

  const sonuc = await saveSettings(prisma, values, me.id);
  if (!sonuc.ok) return { error: sonuc.message, success: null };

  revalidatePath("/admin/settings", "layout");

  return {
    error: null,
    success:
      sonuc.changed.length === 0
        ? "Değişiklik yok."
        : `${sonuc.changed.length} ayar güncellendi. Yeni değerler hemen geçerli.`,
  };
}

export async function saveSmtpAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();

  const rawPassword = formData.get("password");
  const parsed = smtpSettingsSchema.safeParse({
    host: formData.get("host"),
    port: formData.get("port"),
    secure: formData.get("secure") === "on",
    user: formData.get("user") ?? "",
    // Boş parola "değiştirme" demektir, "sil" değil.
    password: typeof rawPassword === "string" && rawPassword !== "" ? rawPassword : undefined,
    from: formData.get("from"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz", success: null };
  }

  await saveSmtpSettings(prisma, parsed.data, undefined, me.id);
  revalidatePath("/admin/settings", "layout");

  return {
    error: null,
    success:
      "SMTP ayarları kaydedildi. İşleyici en geç bir tur içinde yeni ayarla çalışır.",
  };
}

export async function clearSmtpPasswordAction(): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();

  await clearSmtpPassword(prisma, me.id);
  revalidatePath("/admin/settings", "layout");

  return { error: null, success: "Kayıtlı SMTP parolası silindi." };
}

/**
 * Sınama e-postası. Ayarların **gerçekten çalıştığını** kaydetmeden önce
 * görmek gerekir: yanlış bir sunucu adresi yüzünden bildirimlerin sessizce
 * birikmesi, fark edilmesi en zor arızalardan biridir (§12.4).
 */
export async function sendTestEmailAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireSystemAdmin();

  const parsed = testEmailSchema.safeParse({ to: formData.get("to") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz", success: null };
  }

  const settings = await readSmtpSettings(prisma);
  if (!settings) {
    return {
      error: "SMTP ayarları eksik; önce sunucu adresi ve gönderen adresini kaydedin.",
      success: null,
    };
  }

  try {
    const transport = createSmtpTransport(settings);
    await transport.send({
      to: parsed.data.to,
      subject: "Faaliyet Raporlama Sistemi — sınama e-postası",
      text:
        "Bu bir sınama e-postasıdır. Bu iletiyi aldıysanız SMTP ayarları " +
        "çalışıyor demektir.\n\nFaaliyet Raporlama Sistemi",
    });
  } catch (error) {
    // Hata yutulmaz: BT sorumlusu neyin yanlış olduğunu görmeli. Ama ham
    // Node hatası çoğu zaman ne yapılacağını söylemez; tanıdığımız
    // arızaları çevirip **ne yapılacağını** yazıyoruz.
    const mesaj = error instanceof Error ? error.message : String(error);
    return { error: smtpHatasi(mesaj, settings.host), success: null };
  }

  return { error: null, success: `Sınama e-postası ${parsed.data.to} adresine gönderildi.` };
}

/**
 * Bilinen SMTP arızalarını ne yapılacağını söyleyen bir cümleye çevirir.
 *
 * Ham hata metni de korunuyor: çeviremediğimiz bir arızada BT sorumlusu
 * yine de aslını görmeli. Sessizce "gönderilemedi" demek, arızayı gizlemek
 * olurdu.
 */
function smtpHatasi(mesaj: string, host: string): string {
  // Sertifika, sunucu adının başka bir alan adına ait olduğunu söylüyor.
  // En sık sebebi yanlış yazılmış sunucu adresi.
  const altName = mesaj.match(/is not in the cert's altnames:\s*(.+)$/);
  if (mesaj.includes("does not match certificate") && altName) {
    const dogrular = [...altName[1].matchAll(/DNS:([^\s,]+)/g)]
      .map((eslesme) => eslesme[1])
      .filter((ad) => !ad.startsWith("*."));

    const oneri =
      dogrular.length > 0
        ? ` Sunucunun sertifikası şu adresler için geçerli: ${dogrular.join(", ")}. Sunucu adresini bunlardan biriyle değiştirin.`
        : "";

    return (
      `Sunucu adresi "${host}" ile sunucunun sertifikası uyuşmuyor; ` +
      `bağlantı güvenli olmadığı için reddedildi.${oneri} ` +
      `(Ham hata: ${mesaj})`
    );
  }

  if (mesaj.includes("Invalid login") || mesaj.includes("535")) {
    return `Kullanıcı adı ya da parola kabul edilmedi. (Ham hata: ${mesaj})`;
  }

  if (mesaj.includes("ECONNREFUSED") || mesaj.includes("ETIMEDOUT")) {
    return (
      `"${host}" adresine bağlanılamadı. Sunucu adresi, port ve güvenlik ` +
      `duvarı kurallarını kontrol edin. (Ham hata: ${mesaj})`
    );
  }

  return `Gönderilemedi: ${mesaj}`;
}

export async function saveBrandingAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();

  // İkisi de **zorunlu değil**: boş bırakılırsa varsayılana dönülür. Sekme
  // başlığı ve alt şerit her sayfada göründüğü için bir değer hep bulunmalı.
  const baslik = String(formData.get("pageTitle") ?? "").trim();
  const altSerit = String(formData.get("footerText") ?? "").trim();

  if (baslik.length > 100) {
    return { error: "Sayfa başlığı en fazla 100 karakter olabilir.", success: null };
  }
  if (altSerit.length > 200) {
    return { error: "Alt şerit metni en fazla 200 karakter olabilir.", success: null };
  }

  await saveBrandingTexts(
    prisma,
    {
      pageTitle: baslik || DEFAULT_PAGE_TITLE,
      footerText: altSerit || DEFAULT_FOOTER_TEXT,
    },
    me.id,
  );

  const dosya = formData.get("logo");
  if (dosya instanceof File && dosya.size > 0) {
    const sonuc = await saveLogo(
      prisma,
      { type: dosya.type, content: Buffer.from(await dosya.arrayBuffer()) },
      me.id,
    );

    if (!sonuc.ok) return { error: sonuc.message, success: null };
  }

  revalidatePath("/", "layout");

  return { error: null, success: "Özelleştirme ayarları kaydedildi." };
}

export async function removeLogoAction(): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();

  await removeLogo(prisma, me.id);
  revalidatePath("/", "layout");

  return { error: null, success: "Logo kaldırıldı." };
}


/**
 * Tarayıcı bildirimleri kurulumu (Görev 5.3b).
 *
 * **İki ayrı iş, tek düğmede toplanmıyor:** iletişim adresini değiştirmek
 * zararsız, anahtarları yenilemek bütün abonelikleri öldürüyor. Eskiden ikisi
 * aynı yoldan geçiyordu ve adres değiştirmek fiilen imkânsızdı — kod "zaten
 * anahtar var" diye reddediyordu (21.08.2026, ürün sahibi bildirdi).
 */
export async function saveVapidAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();
  const subject = String(formData.get("subject") ?? "");

  // Kurulu sistemde "Kaydet" yalnız adresi günceller.
  const mevcut = await readVapidView(prisma);
  if (mevcut.configured && formData.get("replace") !== "on") {
    const adres = await saveVapidSubject(prisma, subject, me.id);

    if (!adres.ok) return { error: adres.message, success: null };

    revalidatePath("/admin/settings", "layout");
    return { error: null, success: "İletişim adresi kaydedildi.", };
  }

  const sonuc = await generateVapidKeys(
    prisma,
    {
      subject,
      replace: formData.get("replace") === "on",
    },
    me.id,
  );

  if (!sonuc.ok) return { error: sonuc.message, success: null };

  revalidatePath("/admin/settings", "layout");

  return {
    error: null,
    success: sonuc.replaced
      ? "Yeni anahtar çifti üretildi. Mevcut abonelikler geçersizleşti; kullanıcıların bildirimi yeniden açması gerekiyor."
      : "Anahtar çifti üretildi. Kullanıcılar profil sayfalarından bildirimi açabilir.",
  };
}

// ── Örnek veri ────────────────────────────────────────────────────────
//
// Boş bir sistemde ekranların çalıştığı görülemez. Bu iki eylem, uygulamanın
// bütün özelliklerini kapsayan bir örnek şirket kurar ve gerektiğinde temizler.
//
// **Silme, projedeki "fiziksel silme yok" kuralının dar bir istisnasıdır**
// (ürün sahibi kararı, 20.08.2026) ve yalnızca `@ornek.test` damgalı satırlara
// dokunur. Demo bir kayda gerçek veri bağlanmışsa yabancı anahtar işlemi
// reddeder ve hiçbir şey silinmez.

export async function installDemoAction(): Promise<SettingsFormState> {
  await requireSystemAdmin();

  const sonuc = await installDemoData(prisma, {
    password: process.env.DEMO_PASSWORD ?? DEMO_DEFAULT_PASSWORD,
  });

  if (!sonuc.ok) {
    return {
      error:
        "Kök birim yok; örnek veri kurulamadı. Önce organizasyon ağacının kökü oluşturulmalı.",
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");
  return {
    error: null,
    success: `Örnek veri kuruldu. Örnek hesapların parolası: ${
      process.env.DEMO_PASSWORD ?? DEMO_DEFAULT_PASSWORD
    }`,
  };
}

export async function purgeDemoAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();

  // Yazarak onay: tek tıkla geri alınamaz bir temizlik yapılmaz.
  const onay = String(formData.get("onay") ?? "").trim();
  if (onay.toLocaleUpperCase("tr-TR") !== "SİL") {
    return {
      error: "Silmek için onay kutusuna SİL yazmalısınız.",
      success: null,
    };
  }

  const sonuc = await purgeDemoData(prisma, me.id);

  if (!sonuc.ok && sonuc.error === "nothing_to_purge") {
    return { error: "Silinecek örnek veri bulunamadı.", success: null };
  }

  if (!sonuc.ok && sonuc.error === "legacy_demo_origin_unknown") {
    return {
      error:
        "Eski örnek kurulumundaki birimlerin kökeni belirsiz. Önce aşağıdaki her birimi sınıflandırın; hiçbir şey silinmedi.",
      success: null,
    };
  }

  if (!sonuc.ok) {
    console.error("[örnek veri] Temizleme engellendi:", sonuc.detail);
    return {
      error: `Örnek veri silinemedi, hiçbir şey silinmedi. Örnek kayıtlara gerçek veri bağlanmış: ${sonuc.detail}`,
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");
  const o = sonuc.summary;
  return {
    error: null,
    success: `Örnek veri silindi: ${o.users} kullanıcı, ${o.activities} faaliyet, ${o.conversations} konuşma, ${o.followUps} takip maddesi, ${o.helpArticles} yardım yazısı, ${o.notifications} bildirim, ${o.orgUnits} birim, ${o.files} dosya.`,
  };
}

export async function classifyLegacyDemoOriginsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await requireSystemAdmin();

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
        parsed.error.issues[0]?.message ??
        "Her birim için bir köken seçmelisiniz.",
      success: null,
    };
  }

  const sonuc = await classifyLegacyDemoOrgUnits(
    prisma,
    me.id,
    parsed.data.selections,
  );
  if (!sonuc.ok) {
    return {
      error:
        sonuc.error === "candidate_set_changed"
          ? "Birim listesi bu form açıldıktan sonra değişti. Sayfayı yenileyip bütün birimleri yeniden sınıflandırın."
          : "Geçersiz köken seçimi.",
      success: null,
    };
  }

  revalidatePath("/admin/settings", "layout");
  return {
    error: null,
    success: `${sonuc.classified} birimin kökeni kaydedildi. Örnek veriyi artık güvenle silebilirsiniz.`,
  };
}
