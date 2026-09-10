import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { ScoreCard } from "@/components/scoring/score-card";
import { toShellUser } from "@/components/shell/shell-user";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordItem, RecordList } from "@/components/ui/table";
import { getCurrentUser } from "@/server/auth/current-user";
import { subordinateUserIds } from "@/server/authz/visibility";
import { prisma } from "@/server/db";
import {
  readDeclineThreshold,
  readScoreTrends,
  readTeamScores,
  readUserScore,
} from "@/server/scoring/read";
import { SETTING_KEYS, readBooleanSetting } from "@/server/settings/system-settings";

// Ekip skorları (Görev 11.11).
//
// **Liste varsayılan olarak alfabetik sıralanır**, skora göre değil.
// Varsayılan sıralama ekranın ne hakkında olduğunu söyler; skora göre açılan
// bir liste "bu bir yarışma" der.
//
// Genel sıralama **yok**. Liste kapsam içidir: skor bir toplamdır ve toplam,
// görülmeyen kaydı ele verir.

export const metadata = { title: "Ekip skorları" };

export default async function ScoresPage({
  searchParams,
}: {
  searchParams: Promise<{ siralama?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();

  const params = await searchParams;

  const [hamSkorlar, esik, subordinates, siralamaAcik, ownScore] = await Promise.all([
    readTeamScores(prisma, viewer, now),
    readDeclineThreshold(prisma),
    subordinateUserIds(prisma, viewer.id),
    readBooleanSetting(prisma, SETTING_KEYS.scoringRankingEnabled),
    readUserScore(prisma, viewer, viewer.id, now),
  ]);

  // Düşüş işareti geçmişe bakıyor. Trend **tek sorguda** okunuyor: kişi
  // başına okunduğunda altı dönemlik grafik kişi başına altı çok tablolu
  // hesap demekti (denetim 23.08.2026, bulgu 9).
  const trendler = await readScoreTrends(
    prisma,
    viewer,
    hamSkorlar.map((skor) => skor.userId),
  );
  const skorlar = hamSkorlar.map((skor) => ({
    ...skor,
    declining: trendler.get(skor.userId)?.declining ?? false,
  }));

  // **Varsayılan sıralama alfabetik.** Skora göre sıralamak bir tıkla mümkün
  // ama varsayılan değil: varsayılan sıralama ekranın ne hakkında olduğunu
  // söyler ve skora göre açılan bir liste "bu bir yarışma" der.
  //
  // Sıralama **kapsam içidir**; genel sıralama yok. Skor bir toplamdır ve
  // toplam, görülmeyen kaydı ele verir.
  const skoraGore = siralamaAcik && params.siralama === "skor";
  if (skoraGore) skorlar.sort((a, b) => b.total - a.total);

  return (
    <AppShell user={await toShellUser(user, subordinates)}>
      <Page isaret="skorlar">
        <PageHeader
          title="Ekip skorları"
          description="Bu dönemki puanları ve zaman içindeki değişimi görebilirsiniz. Liste yalnızca sizin kapsamınızdaki kişileri içerir."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Skorlar" }]}
        />

        {ownScore ? (
          <Card>
            <CardHeader
              title="Benim puanım"
              description="Temel puanınız üç bölümden oluşur; takdir katkısı genel puana ayrıca eklenebilir."
            />
            <CardBody>
              <ScoreCard score={ownScore} appreciations={null} />
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Bu dönem"
            description={`Temel puan 100 üzerinden hesaplanır; takdir katkısıyla genel puan 100’ü aşabilir. ${esik} dönem üst üste düşüş görülen kişinin yanında uyarı gösterilir.`}
            action={
              siralamaAcik ? (
                <Link
                  href={skoraGore ? "/scores" : "/scores?siralama=skor"}
                  className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
                >
                  {skoraGore ? "Alfabetik sırala" : "Skora göre sırala"}
                </Link>
              ) : null
            }
          />

          {skorlar.length === 0 ? (
            <EmptyState
              title="Gösterilecek skor yok"
              description="Skor sistemi kapalı olabilir ya da ekibinizde puanlanan kullanıcı bulunmuyor. Sistem ayarlarından açılır."
            />
          ) : (
            <RecordList>
              {skorlar.map((skor) => (
                <RecordItem key={skor.userId} data-test="skor-satiri">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar
                        user={{ id: skor.userId, fullName: skor.fullName }}
                        size={28}
                      />
                      <Link
                        href={`/users/${skor.userId}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {skor.fullName}
                      </Link>
                      <span className="text-[length:var(--text-xs)] text-muted">
                        {skor.writtenDays}/{skor.expectedDays} iş günü
                      </span>
                    </span>

                    <span className="flex items-center gap-3">
                      {skor.declining ? (
                        <Badge tone="danger">{esik} dönemdir düşüyor</Badge>
                      ) : null}
                      {skor.regularity === 0 && skor.expectedDays > 0 ? (
                        <Badge tone="danger">bu dönem kayıt yok</Badge>
                      ) : null}
                      <span className="mono text-[length:var(--text-lg)] font-semibold text-ink">
                        {skor.total}
                      </span>
                      {skor.appreciationCount > 0 ? (
                        <span className="text-[length:var(--text-xs)] text-muted">
                          +{skor.appreciationPoints} takdir katkısı
                        </span>
                      ) : null}
                    </span>
                  </div>
                </RecordItem>
              ))}
            </RecordList>
          )}
        </Card>
      </Page>
    </AppShell>
  );
}
