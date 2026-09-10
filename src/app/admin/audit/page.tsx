import { redirect } from "next/navigation";

import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  listAuditEntries,
} from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordItem, RecordList } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar } from "@/components/filters/filter-bar";
import { resolvePageSize } from "@/server/preferences/page-size";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { formatInstantPrecise } from "@/shared/format/date-time";

// Denetim izi (§15.2). Kayıtlar **içerik taşımaz**: başlık, açıklama, gerekçe
// ve mesaj metni burada görünmez, çünkü bu ekranı sistem yöneticisi kullanır
// ve onun içeriğe erişimi yoktur (§15.1).

export const metadata = { title: "İşlem kayıtları" };
export const dynamic = "force-dynamic";

const OBJECT_LABELS: Record<string, string> = {
  activity: "Faaliyet",
  conversation: "Konuşma",
  user: "Kullanıcı",
  org_unit: "Birim",
  setting: "Ayar",
  session: "Oturum",
};

const ACTION_LABELS: Record<string, string> = {
  activity_created: "faaliyet yazıldı",
  activity_revised: "faaliyet düzeltildi",
  activity_cancelled: "faaliyet iptal edildi",
  conversation_opened: "soru soruldu",
  conversation_replied: "konuşmaya yazıldı",
  conversation_closed: "konuşma kapatıldı",
  user_created: "kullanıcı eklendi",
  user_updated: "kullanıcı düzenlendi",
  user_deactivated: "kullanıcı pasifleştirildi",
  user_reactivated: "kullanıcı aktifleştirildi",
  user_password_set: "yönetici parola belirledi",
  user_password_changed: "kullanıcı parolasını değiştirdi",
  user_password_reset: "parola sıfırlandı",
  org_unit_created: "birim açıldı",
  org_unit_updated: "birim düzenlendi",
  org_unit_moved: "birim taşındı",
  org_unit_deactivated: "birim pasifleştirildi",
  org_unit_reactivated: "birim aktifleştirildi",
  settings_changed: "sistem ayarı değişti",
  work_calendar_changed: "çalışma takvimi değişti",
  holiday_added: "tatil eklendi",
  holiday_removed: "tatil çıkarıldı",
  smtp_changed: "SMTP ayarı değişti",
  login_succeeded: "giriş yapıldı",
  login_failed: "giriş denemesi başarısız",
  login_locked: "hesap kilitlendi",
};

export default async function AuditAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    objectType?: string;
    action?: string;
    page?: string;
    /** Sayfada kaç kayıt; seçim çerezde de hatırlanır. */
    boyut?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!canManageOrganization(user)) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="İşlem kayıtlarını yalnızca sistem yöneticisi görebilir."
      />
    );
  }

  const params = await searchParams;
  const sayfaBoyu = await resolvePageSize(params.boyut);
  const page = Number(params.page ?? 1);

  const sonuc = await listAuditEntries(
    prisma,
    {
      objectType: params.objectType || undefined,
      action: params.action || undefined,
    },
    Number.isFinite(page) ? page : 1,
    sayfaBoyu,
  );

  const sayfaAdresi = (hedef: number) =>
    buildQueryAddress(
      "/admin/audit",
      {
        objectType: params.objectType,
        action: params.action,
        boyut: String(sayfaBoyu),
      },
      { page: String(hedef) },
    );

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page isaret="islem-kayitlari">
        <PageHeader
          title="İşlem kayıtları"
          description="Kim, ne zaman, neyi değiştirdi. Kayıtlar değiştirilemez ve silinemez. Faaliyet içeriği burada görünmez — kayıt ne yapıldığını söyler, ne yazıldığını değil."
          breadcrumbs={[{ label: "Yönetim" }, { label: "İşlem kayıtları" }]}
        />

        <AdminNav isRoot={user.isRoot} />

        {/* Süzgeç şeridi diğer listelerle **aynı bileşen** (Görev 11.4):
            burada elle yazılmış ayrı bir form vardı ve sayfa boyu seçimi
            yoktu. Ayrı form, ayrı davranış demekti. */}
        <Card>
          <FilterBar
            action="/admin/audit"
            clearHref="/admin/audit"
            filtered={Boolean(params.objectType) || Boolean(params.action)}
            pageSize={sayfaBoyu}
            submitLabel="Süz"
            fields={[
              {
                name: "objectType",
                label: "Nesne",
                value: params.objectType ?? "",
                width: "w-52",
                options: [
                  { value: "", label: "Tümü" },
                  ...Object.values(AUDIT_OBJECTS).map((value) => ({
                    value,
                    label: OBJECT_LABELS[value] ?? value,
                  })),
                ],
              },
              {
                name: "action",
                label: "İşlem",
                value: params.action ?? "",
                width: "w-64",
                options: [
                  { value: "", label: "Tümü" },
                  ...Object.values(AUDIT_ACTIONS).map((value) => ({
                    value,
                    label: ACTION_LABELS[value] ?? value,
                  })),
                ],
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            title="Kayıtlar"
            description={`${sonuc.total} kayıt${
              sonuc.pageCount > 1 ? ` · sayfa ${sonuc.page}/${sonuc.pageCount}` : ""
            }`}
          />

          {sonuc.entries.length === 0 ? (
            <EmptyState
              title="Kayıt yok"
              description="Seçtiğiniz süzgeçle eşleşen bir işlem bulunamadı."
            />
          ) : (
            // Tablo değil kayıt defteri (21.08.2026, ürün sahibi bildirdi).
            //
            // Altı sütunun sonuncusu ham JSON taşıyordu; satır her ekranda
            // taşıyor ve okumak için sağa sola kaydırmak gerekiyordu. Denetim
            // kaydı zaten "kim, ne zaman, neyi, ne yaptı" cümlesidir —
            // sütunlara bölmek onu okunur yapmıyordu.
            <RecordList>
              {sonuc.entries.map((entry) => (
                <RecordItem key={entry.id} data-test="denetim-kaydi" className="sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <Badge>
                        {OBJECT_LABELS[entry.objectType] ?? entry.objectType}
                      </Badge>
                      <span className="font-medium text-ink">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </p>
                    <time className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                      {formatInstantPrecise(entry.createdAt)}
                    </time>
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-sm)] text-muted">
                    <span className="font-medium text-ink">
                      {entry.userName ?? "bilinmeyen kullanıcı"}
                    </span>
                    {/* Vekâletle yapılan işlem "X adına Y" olarak okunur
                        (§4.5). Sorgu bu alanı zaten döndürüyordu ama ekran
                        çizmiyordu; vekilin kararı, kendi kararı gibi
                        görünüyordu (denetim 21.08.2026, bulgu 15). */}
                    {entry.actualUserName ? (
                      <span className="text-[length:var(--text-sm)] text-muted">
                        · {entry.actualUserName} adına
                      </span>
                    ) : null}
                    {entry.ipAddress ? (
                      <>
                        <span aria-hidden className="text-line-strong">·</span>
                        <span className="mono text-[length:var(--text-xs)] text-faint">
                          {entry.ipAddress}
                        </span>
                      </>
                    ) : null}
                  </p>

                  <AyrintiSatiri detail={entry.detail} />
                </RecordItem>
              ))}
            </RecordList>
          )}

          <Pagination
            page={sonuc.page}
            pageCount={sonuc.pageCount}
            hrefFor={sayfaAdresi}
            totalLabel={`Toplam ${sonuc.total} kayıt`}
          />
        </Card>
      </Page>
    </AppShell>
  );
}

/**
 * Denetim kaydının ayrıntısı.
 *
 * Ham JSON yerine okunur alan-değer çiftleri. Bilinen alanlar Türkçe adıyla
 * yazılır; bilinmeyen alan **gizlenmez**, anahtarıyla gösterilir — denetim
 * kaydının değeri eksiksizliğinde, sunum kolaylığı için bilgi kırpılmaz.
 */
const AYRINTI_ADLARI: Record<string, string> = {
  revisionNo: "revizyon",
  approvalStatus: "onay durumu",
  activityDate: "faaliyet günü",
  email: "e-posta",
  orgUnitId: "birim",
  isUnitManager: "birim yöneticisi",
  isSystemAdmin: "sistem yöneticisi",
  writesActivities: "faaliyet yazar",
  reason: "gerekçe",
  before: "önce",
  after: "sonra",
};

function okunur(deger: unknown): string {
  if (deger === null || deger === undefined) return "—";
  if (typeof deger === "boolean") return deger ? "evet" : "hayır";
  if (typeof deger === "object") return JSON.stringify(deger);
  return String(deger);
}

function AyrintiSatiri({ detail }: { detail: unknown }) {
  if (detail === null || detail === undefined) return null;

  if (typeof detail !== "object") {
    return (
      <p className="mt-1.5 text-[length:var(--text-xs)] text-faint">
        {okunur(detail)}
      </p>
    );
  }

  const girdiler = Object.entries(detail as Record<string, unknown>);
  if (girdiler.length === 0) return null;

  return (
    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--text-xs)]">
      {girdiler.map(([anahtar, deger]) => (
        <div key={anahtar} className="flex items-baseline gap-1.5">
          <dt className="text-faint">{AYRINTI_ADLARI[anahtar] ?? anahtar}:</dt>
          <dd className="mono break-all text-muted">{okunur(deger)}</dd>
        </div>
      ))}
    </dl>
  );
}
