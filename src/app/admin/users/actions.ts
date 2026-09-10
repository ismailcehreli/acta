"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { AuthorizationError, requireSystemAdmin } from "@/server/authz/admin";
import { canManageUser, manageableUnitIds } from "@/server/authz/unit-admin";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { sendPasswordResetForUser } from "@/server/auth/reset";
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  recordAudit,
} from "@/server/audit/log";
import { sendWelcomeEmail } from "@/server/auth/reset";
import { createUser } from "@/server/users/create";
import { deactivateUser, reactivateUser } from "@/server/users/deactivate";
import {
  canDeactivate,
  setUserPassword,
  updateRootSelf,
  updateUser,
  updateUserByManager,
} from "@/server/users/update";
import { closeOpenConversationsForUser } from "@/server/conversations/close-for-deactivation";
import {
  closeConversationsForUserSchema,
  createUserSchema,
  deactivateUserSchema,
  managerCreateUserSchema,
  managerUpdateUserSchema,
  rootSelfUpdateSchema,
  setUserPasswordSchema,
  updateUserSchema,
} from "@/shared/schemas/user";

import type { UserFormState } from "./form-state";

/**
 * Personel işlemi yapabilen kişi: sistem yöneticisi ya da bölüm yöneticisi
 * (Görev 11.7). Hedefe göre kapsam ayrıca sınanır.
 */
async function requireUserManager() {
  const me = await getCurrentUser();
  if (!me) throw new AuthorizationError("Oturum bulunamadı.");

  if (!me.isSystemAdmin && !me.isUnitManager) {
    throw new AuthorizationError(
      "Bu işlem için sistem yöneticisi ya da birim yöneticisi yetkisi gerekir.",
    );
  }

  return me;
}

/** Hedef kullanıcı üzerinde işlem yetkisi; yoksa form hatası döner. */
async function kapsamHatasi(
  actorId: string,
  targetId: string,
): Promise<UserFormState | null> {
  if (await canManageUser(prisma, actorId, targetId)) return null;

  return {
    error: "Bu kullanıcı üzerinde işlem yapma yetkiniz yok.",
    success: null,
    blockers: null,
  };
}

function refreshUserPages(userId?: string): void {
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

/**
 * Müdürün açtığı hesabın geçici parolası.
 *
 * Kimseye gösterilmez ve hiçbir yere yazılmaz; yalnız hesabın parolasız
 * kalmaması için var. Kullanıcı kendi e-postasına giden bağlantıyla kendi
 * parolasını kurar.
 */
function kimseninBilmedigiParola(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Bölüm müdürünün kullanıcı düzenlemesi: yalnız ad ve unvan.
 *
 * Diğer alanlar okunmuyor bile — `managerUpdateUserSchema` üç alan tanıyor,
 * `updateUserByManager` geri kalanını veritabanından alıyor.
 */
async function mudurGuncellemesi(
  actorId: string,
  formData: FormData,
): Promise<UserFormState> {
  const parsed = managerUpdateUserSchema.safeParse({
    id: formData.get("id"),
    fullName: formData.get("fullName"),
    title: formData.get("title"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz",
      success: null,
      blockers: null,
    };
  }

  const kapsam = await kapsamHatasi(actorId, parsed.data.id);
  if (kapsam) return kapsam;

  // Kapsam listesi **taşınmıyor**: servise yalnız aktörün kimliği veriliyor
  // ve kapsam yazma ifadesinin içinde, o anki ağaca göre hesaplanıyor.
  // Yukarıdaki `kapsamHatasi` yalnız erken ve anlaşılır bir cevap için;
  // kararın dayandığı kontrol serviste.
  const result = await updateUserByManager(prisma, parsed.data, actorId);
  if (!result.ok) {
    return { error: result.message, success: null, blockers: null };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: `"${result.user.fullName}" güncellendi.`,
    blockers: null,
  };
}

/**
 * Bölüm müdürünün personel eklemesi.
 *
 * Müdür yalnız kim olduğunu ve nereye ekleneceğini söyler; **bayrakları ve
 * rolleri sunucu belirler.** İlk denemede kutuları formdan kaldırmak yeterli
 * sanılmıştı; eylem gönderilmeyen kutuyu "işaretlenmemiş" sayıp `false`
 * yazdı ve müdürün eklediği personelden faaliyet beklenmez, kişi
 * skorlanmaz oldu (23.08.2026, ikinci denetim turu). Ekranda alan olmaması
 * koruma değildir; karar veriyi yazan yolun üstünde durmalı.
 */
async function mudurEklemesi(
  actorId: string,
  formData: FormData,
): Promise<UserFormState> {
  const parsed = managerCreateUserSchema.safeParse({
    fullName: formData.get("fullName"),
    title: formData.get("title"),
    email: formData.get("email"),
    orgUnitId: formData.get("orgUnitId"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz",
      success: null,
      blockers: null,
    };
  }

  // Kapsam **serviste**, kaydın açıldığı işlemin içinde doğrulanıyor:
  // burada hesaplanıp taşınsaydı, arada ağaç değiştiğinde bayat kalırdı.
  const result = await createUser(
    prisma,
    {
      ...parsed.data,
      // Sunucunun kararı; istekten okunmuyor.
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      isScored: true,
      canAppreciate: false,
      canViewReports: false,
      canViewScoreReports: false,
      // Müdür parola belirleyemez (tasarım, Paket F): müdürün bildiği parola,
      // denetim izindeki "bu kaydı kim yazdı" cevabını zayıflatır.
      initialPassword: kimseninBilmedigiParola(),
    },
    actorId,
    new Date(),
    // Bildirim hesapla **aynı işlemde** yazılır: parolayı kimse bilmiyor,
    // tek giriş yolu bu bağlantı. Yazılamazsa hesap da oluşmamalı.
    { welcomeEmail: true, managerScope: { actorId } },
  );

  if (!result.ok) {
    return { error: result.message, success: null, blockers: null };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: `"${result.user.fullName}" eklendi. Kullanıcıya parola belirleme bağlantısı içeren bir e-posta gönderildi.`,
    blockers: null,
  };
}

export async function createUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();

  if (!me.isSystemAdmin) {
    return mudurEklemesi(me.id, formData);
  }

  const parsed = createUserSchema.safeParse({
    fullName: formData.get("fullName"),
    // Unvan hiç okunmuyordu: yeni kullanıcı unvansız açılıyordu ve müdüre
    // verilen iki alandan biri kâğıt üstünde kalıyordu (bulgu 13).
    title: formData.get("title"),
    email: formData.get("email"),
    orgUnitId: formData.get("orgUnitId"),
    isUnitManager: formData.get("isUnitManager") === "on",
    isSystemAdmin: formData.get("isSystemAdmin") === "on",
    writesActivities: formData.get("writesActivities") === "on",
    // İşaretsiz kutu hiçbir şey göndermez; `!== "off"` bu yüzden her zaman
    // doğruydu ve skoru kapalı kullanıcı hiç açılamıyordu (bulgu 13).
    isScored: formData.get("isScored") === "on",
    canAppreciate: formData.get("canAppreciate") === "on",
    canViewReports: formData.get("canViewReports") === "on",
    canViewScoreReports: formData.get("canViewScoreReports") === "on",
    // **Müdür parola belirleyemez** (tasarım, Paket F). Müdürün bildiği
    // parola, denetim izindeki "bu kaydı kim yazdı" cevabını zayıflatır.
    // Hesap kimsenin bilmediği bir parolayla açılır; kullanıcı kendi
    // e-postasına giden bağlantıyla kendi parolasını kurar.
    initialPassword: formData.get("initialPassword"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz",
      success: null,
      blockers: null,
    };
  }

  // Müdür yalnız **kendi alt ağacına** personel açar; birim seçici zaten
  // daraltılmış ama istek elle kurulabilir ve karar burada verilir.
  const yonetilebilir = await manageableUnitIds(prisma, me.id);
  if (!yonetilebilir.includes(parsed.data.orgUnitId)) {
    return {
      error: "Bu birime kullanıcı ekleme yetkiniz yok.",
      success: null,
      blockers: null,
    };
  }

  const result = await createUser(prisma, parsed.data, me.id);

  if (!result.ok) {
    return { error: result.message, success: null, blockers: null };
  }

  // Hoş geldiniz e-postası **isteğe bağlı** (21.08.2026, ürün sahibi isteği).
  //
  // Parola postayla gitmez: kullanıcıya sistemin adresi ve kendi giriş adresi
  // bildirilir, parolayı kendisi belirlesin diye sıfırlama bağlantısı
  // gönderilir. Sistem yöneticisinin belirlediği başlangıç parolası böylece
  // hiç dolaşıma girmez.
  let postaNotu = "Başlangıç parolasını kullanıcıya güvenli bir yoldan iletin.";

  if (formData.get("sendWelcome") === "on") {
    const posta = await sendWelcomeEmail(prisma, result.user.id, new Date());

    postaNotu = posta.ok
      ? "Kullanıcıya parola belirleme bağlantısı içeren bir e-posta gönderildi."
      : // Sessiz başarısızlık yok: hesap açıldı ama posta gitmediyse yönetici
        // bunu bilmeli, yoksa kullanıcının e-postayı beklemesini söyler.
        "Hesap açıldı ancak e-posta kuyruğa yazılamadı; parolayı kendiniz iletin.";
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: `"${result.user.fullName}" eklendi. ${postaNotu}`,
    blockers: null,
  };
}

export async function deactivateUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();

  const parsed = deactivateUserSchema.safeParse({ id: formData.get("id") });

  if (!parsed.success) {
    return { error: "Kullanıcı bilgisi geçersiz.", success: null, blockers: null };
  }

  // Kendi hesabı **kapsam kontrolünden geçmez** ama buradaki mesaj daha
  // açıklayıcı: `canDeactivate` "kendi hesabınızı pasifleştiremezsiniz" der,
  // kapsam kontrolü ise yalnız "yetkiniz yok". Kullanıcıya sebebi söylenmeli.
  if (parsed.data.id !== me.id) {
    const kapsam = await kapsamHatasi(me.id, parsed.data.id);
    if (kapsam) return kapsam;
  }

  // Geri dönüşü olmayan iki durum: kendini pasifleştirmek ve son sistem
  // yöneticisini kapatmak. İkisi de sistemi yönetilemez bırakırdı.
  const izin = await canDeactivate(prisma, me.id, parsed.data.id);
  if (!izin.allowed) {
    return { error: izin.message, success: null, blockers: null };
  }

  const result = await deactivateUser(prisma, parsed.data.id, new Date(), me.id);

  if (!result.ok) {
    if (result.reason === "user_not_found") {
      return { error: "Kullanıcı bulunamadı.", success: null, blockers: null };
    }
    if (result.reason === "root_protected") {
      return {
        error: "Ana sistem yöneticisi hesabı korunuyor.",
        success: null,
        blockers: null,
      };
    }

    // Engeller sessizce yutulmaz; sistem yöneticisi ne yapması gerektiğini
    // görmeli (§4.6).
    return {
      error:
        "Bu kullanıcının üzerinde açık iş var. Devredilmeden veya kapatılmadan pasifleştirilemez.",
      success: null,
      blockers: result.blockers,
    };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: `"${result.user.fullName}" pasifleştirildi; açık oturumları kapatıldı.`,
    blockers: null,
  };
}

export async function reactivateUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();

  const parsed = deactivateUserSchema.safeParse({ id: formData.get("id") });

  if (!parsed.success) {
    return { error: "Kullanıcı bilgisi geçersiz.", success: null, blockers: null };
  }

  const kapsam = await kapsamHatasi(me.id, parsed.data.id);
  if (kapsam) return kapsam;

  const result = await reactivateUser(prisma, parsed.data.id, new Date(), me.id);

  if (!result.ok) {
    const mesajlar: Record<typeof result.reason, string> = {
      user_not_found: "Kullanıcı bulunamadı.",
      already_active: "Kullanıcı zaten aktif.",
      inactive_org_unit:
        "Kullanıcının birimi pasif. Önce birimi organizasyon ekranından aktifleştirin.",
    };

    return { error: mesajlar[result.reason], success: null, blockers: null };
  }

  refreshUserPages(parsed.data.id);
  return {
    error: null,
    // Yöneticilik ve parola konusundaki iki gerçek açıkça yazılır; kullanıcı
    // "her şey eskisi gibi geri geldi" varsayımına düşmemeli.
    success: `"${result.user.fullName}" aktifleştirildi. Birim yöneticiliği geri verilmedi; parolası değişmedi.`,
    blockers: null,
  };
}

/**
 * Pasifleştirmenin önündeki açık konuşmaları gerekçeyle kapatır (§9.3).
 * Ayrı bir adımdır: kapatma ile pasifleştirme tek düğmeye bağlansaydı, sistem
 * yöneticisi ne kapattığını görmeden onaylamış olurdu.
 */
export async function closeConversationsForUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  await requireSystemAdmin();
  const me = await getCurrentUser();
  if (!me) return { error: "Oturum bulunamadı.", success: null, blockers: null };

  const parsed = closeConversationsForUserSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz",
      success: null,
      blockers: null,
    };
  }

  if (!(await canManageUser(prisma, me.id, parsed.data.id))) {
    return {
      error: "Bu kullanıcı üzerinde işlem yapma yetkiniz yok.",
      success: null,
      blockers: null,
    };
  }

  const outcome = await closeOpenConversationsForUser(
    prisma,
    { id: me.id, isSystemAdmin: me.isSystemAdmin },
    parsed.data.id,
    parsed.data.reason,
    new Date(),
  );

  refreshUserPages(parsed.data.id);

  // Kısmi başarı gizlenmez: kapanmayan konuşma varsa pasifleştirme yine
  // engellenecek ve sebebi ekranda görünmeli.
  if (outcome.failed > 0) {
    return {
      error: `${outcome.closed} konuşma kapatıldı, ${outcome.failed} tanesi kapatılamadı.`,
      success: null,
      blockers: null,
    };
  }

  return {
    error: null,
    success:
      outcome.closed === 0
        ? "Kapatılacak açık konuşma yok."
        : `${outcome.closed} konuşma gerekçeyle kapatıldı.`,
    blockers: null,
  };
}

export async function updateUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();

  // **Müdür ve sistem yöneticisi ayrı yollardan geçer.** Tek bir şemayla
  // ilerleyip sonra fazlalığı temizlemek yetmiyordu: temizlik iki bayrakla
  // sınırlıydı, e-posta ve birim geçiyordu ve hesap devralınabiliyordu
  // (denetim 23.08.2026, bulgu 4). Müdür yolu artık fazla alanı
  // **hiç görmüyor**.
  if (!me.isSystemAdmin) {
    return mudurGuncellemesi(me.id, formData);
  }

  if (me.isRoot && String(formData.get("id") ?? "") === me.id) {
    const rootParsed = rootSelfUpdateSchema.safeParse({
      id: formData.get("id"),
      orgUnitId: formData.get("orgUnitId"),
      writesActivities: formData.get("writesActivities") === "on",
      isScored: formData.get("isScored") === "on",
      canAppreciate: formData.get("canAppreciate") === "on",
      canViewReports: formData.get("canViewReports") === "on",
      canViewScoreReports: formData.get("canViewScoreReports") === "on",
    });

    if (!rootParsed.success) {
      return {
        error: rootParsed.error.issues[0]?.message ?? "Girdi geçersiz",
        success: null,
        blockers: null,
      };
    }

    const result = await updateRootSelf(prisma, rootParsed.data, me.id);
    if (!result.ok) return { error: result.message, success: null, blockers: null };

    refreshUserPages(me.id);
    return {
      error: null,
      success: "Ana hesap ayarları güncellendi.",
      blockers: null,
    };
  }

  const parsed = updateUserSchema.safeParse({
    id: formData.get("id"),
    fullName: formData.get("fullName"),
    title: formData.get("title"),
    email: formData.get("email"),
    orgUnitId: formData.get("orgUnitId"),
    isUnitManager: formData.get("isUnitManager") === "on",
    isSystemAdmin: formData.get("isSystemAdmin") === "on",
    writesActivities: formData.get("writesActivities") === "on",
    isScored: formData.get("isScored") === "on",
    canAppreciate: formData.get("canAppreciate") === "on",
    canViewReports: formData.get("canViewReports") === "on",
    canViewScoreReports: formData.get("canViewScoreReports") === "on",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz",
      success: null,
      blockers: null,
    };
  }

  const kapsam = await kapsamHatasi(me.id, parsed.data.id);
  if (kapsam) return kapsam;

  // Müdür kişiyi **başka birime taşıyamaz**: hedef birim kendi ağacının
  // dışında olabilir ve taşıma ağaç kararıdır.
  const yonetilebilir = await manageableUnitIds(prisma, me.id);
  if (!yonetilebilir.includes(parsed.data.orgUnitId)) {
    return {
      error: "Kullanıcıyı bu birime taşıma yetkiniz yok.",
      success: null,
      blockers: null,
    };
  }

  const result = await updateUser(prisma, parsed.data, me.id);
  if (!result.ok) {
    return { error: result.message, success: null, blockers: null };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: `"${result.user.fullName}" güncellendi.`,
    blockers: null,
  };
}

/**
 * Sistem yöneticisi bir kullanıcıya yeni parola belirler. Mevcut parola
 * sorulmaz: buraya zaten kullanıcı parolasını unuttuğu için gelinir (§15.1).
 */
/**
 * Parolayı **doğrudan belirleme** — yalnız sistem yöneticisi (Görev 11.7).
 *
 * Bölüm müdürü bu yolu kullanamaz; onun için `triggerPasswordResetAction`
 * var. Müdürün belirlediği parola, müdürün bildiği paroladır: o andan sonra
 * "bu kaydı kim yazdı" sorusunun cevabı kesin olmaktan çıkar ve denetim
 * izinin değeri düşer.
 */
export async function setUserPasswordAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireSystemAdmin();

  const parsed = setUserPasswordSchema.safeParse({
    id: formData.get("id"),
    newPassword: formData.get("newPassword"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz",
      success: null,
      blockers: null,
    };
  }

  const kapsam = await kapsamHatasi(me.id, parsed.data.id);
  if (kapsam) return kapsam;

  const result = await setUserPassword(
    prisma,
    parsed.data.id,
    parsed.data.newPassword,
    new Date(),
    me.id,
  );

  if (!result.ok) return { error: result.message, success: null, blockers: null };

  refreshUserPages(parsed.data.id);
  return {
    error: null,
    success:
      `Parola değiştirildi; ${result.revokedSessionCount} açık oturum kapatıldı. ` +
      "Yeni parolayı kullanıcıya güvenli bir yoldan iletin.",
    blockers: null,
  };
}

/**
 * Şifre sıfırlama bağlantısı gönderir (Görev 11.7).
 *
 * Bölüm müdürü ve sistem yöneticisi tetikler. Parola **değişmez**; bağlantı
 * personelin kendi e-postasına gider ve şifreyi kişi kendisi belirler.
 * İşlem denetim izine yazılır: "kim, kimin için tetikledi" sonradan
 * sorulabilmeli.
 */
export async function triggerPasswordResetAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();

  const hedefId = String(formData.get("id") ?? "");
  const kapsam = await kapsamHatasi(me.id, hedefId);
  if (kapsam) return kapsam;

  const sonuc = await sendPasswordResetForUser(prisma, hedefId, new Date());
  if (!sonuc.ok) {
    return {
      error: "Sıfırlama bağlantısı gönderilemedi; hesap pasif olabilir.",
      success: null,
      blockers: null,
    };
  }

  await recordAudit(prisma, {
    userId: me.id,
    objectType: AUDIT_OBJECTS.user,
    objectId: hedefId,
    action: AUDIT_ACTIONS.userUpdated,
    detail: { islem: "şifre sıfırlama bağlantısı gönderildi" },
    now: new Date(),
  });

  refreshUserPages(hedefId);
  return {
    error: null,
    success:
      "Sıfırlama bağlantısı kullanıcının e-posta adresine gönderildi. Parolayı kendisi belirleyecek.",
    blockers: null,
  };
}
