import Link from "next/link";

import {
  profileWeights,
  type ScoreProfile,
  type ScoreWeights,
} from "@/server/scoring/compute";
import { SETTING_KEYS } from "@/server/settings/registry";

const PROFILE_LABELS: Record<ScoreProfile, string> = {
  employee: "Onaya tabi çalışan",
  unapproved: "Onaya tabi olmayan çalışan",
  manager: "Yönetici",
};

function numberValue(values: Record<string, string>, key: string, fallback: number) {
  const value = Number(values[key]);
  return Number.isFinite(value) ? value : fallback;
}

function readWeights(values: Record<string, string>): ScoreWeights {
  return {
    regularity: numberValue(values, SETTING_KEYS.scoringWeightRegularity, 60),
    acceptance: numberValue(values, SETTING_KEYS.scoringWeightAcceptance, 30),
    approval: numberValue(values, SETTING_KEYS.scoringWeightApproval, 30),
    followUp: numberValue(values, SETTING_KEYS.scoringWeightFollowUp, 10),
  };
}

function readAppreciationPoints(values: Record<string, string>): number {
  return numberValue(values, SETTING_KEYS.scoringAppreciationPoints, 1);
}

function distribution(weights: ScoreWeights): string[] {
  const dimensions: Array<[string, number]> = [
    ["Düzenli raporlama", weights.regularity],
    ["Kabul oranı", weights.acceptance],
    ["Onay süresi", weights.approval],
    ["Takip disiplini", weights.followUp],
  ];

  return dimensions
    .filter(([, value]) => value > 0)
    .map(([label, value]) => `${label} ${value} puan`);
}

export function ScorePolicy({ values }: { values: Record<string, string> }) {
  const weights = readWeights(values);
  const appreciationPoints = readAppreciationPoints(values);
  const profiles: ScoreProfile[] = ["employee", "unapproved", "manager"];

  return (
    <div className="border-t border-line pt-4">
      <p className="text-[length:var(--text-sm)] font-medium text-ink">
        Güncel ayarlarla temel puan 100 üzerinden şöyle dağılıyor
      </p>
      <p className="mt-1 text-[length:var(--text-sm)] text-muted">
        Temel puan, kişinin profilindeki üç bölümün toplamıdır. Onaylanmış
        faaliyetlere verilen takdirler buna ayrıca eklenir; bu nedenle genel puan
        100’ü aşabilir. Ağırlık ve takdir puanı değişiklikleri açık dönemde ve
        sonraki dönemlerde kullanılır; kapanmış dönemler değişmez.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {profiles.map((profile) => (
          <div key={profile} className="rounded-(--radius-sm) border border-line px-3.5 py-3">
            <dt className="text-[length:var(--text-sm)] font-medium text-ink">
              {PROFILE_LABELS[profile]}
            </dt>
            <dd className="mt-1 text-[length:var(--text-xs)] leading-normal text-muted">
              {distribution(profileWeights(profile, weights)).join(" · ")}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[length:var(--text-sm)] text-muted">
        Takdir katkısı: Onaylanmış bir faaliyete verilen her geçerli takdir{" "}
        <span className="font-medium text-ink">+{appreciationPoints} puan</span> ekler.
      </p>

      <div className="mt-5 rounded-(--radius-sm) border border-line bg-inset/30 px-3.5 py-3">
        <p className="text-[length:var(--text-sm)] font-medium text-ink">
          Skor hesabında kullanılan süreler
        </p>
        <p className="mt-1 text-[length:var(--text-xs)] text-muted">
          Bu sayılar ilgili hatırlatmaları ve skor hesabını birlikte etkiler.
        </p>
        <dl className="mt-3 grid gap-2 text-[length:var(--text-sm)] sm:grid-cols-3">
          <div>
            <dt className="text-muted">Onay süresi</dt>
            <dd className="font-medium text-ink">
              {numberValue(values, SETTING_KEYS.pendingApprovalBusinessDays, 2)} iş günü
            </dd>
            <Link className="text-xs text-primary underline-offset-4 hover:underline" href="#ayar-onay-akisi">
              Onay akışı ayarı
            </Link>
          </div>
          <div>
            <dt className="text-muted">Cevap süresi</dt>
            <dd className="font-medium text-ink">
              {numberValue(values, SETTING_KEYS.overdueAnswerBusinessDays, 3)} iş günü
            </dd>
            <Link className="text-xs text-primary underline-offset-4 hover:underline" href="#ayar-soru-cevap">
              Soru–cevap ayarı
            </Link>
          </div>
          <div>
            <dt className="text-muted">Takipte hareketsizlik</dt>
            <dd className="font-medium text-ink">
              {numberValue(values, SETTING_KEYS.followUpStaleBusinessDays, 5)} iş günü
            </dd>
            <Link className="text-xs text-primary underline-offset-4 hover:underline" href="#ayar-takip-maddeleri">
              Takip maddeleri ayarı
            </Link>
          </div>
        </dl>
      </div>
    </div>
  );
}
