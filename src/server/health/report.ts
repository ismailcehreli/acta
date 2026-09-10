// Sağlık raporu (tasarım §12.4): veritabanı bağlantısı, bildirim kuyruğu
// derinliği ve zamanlayıcı gecikmesi dışarıdan izlenebilir olmalıdır.
//
// Üç ölçüm de gerçektir (Görev 5.6). `source` alanı yine döner: ölçüm bir
// sebeple yapılamazsa `placeholder` kalır ve izleme tarafı ölçülmemiş bir
// değeri ölçülmüş sanmaz.

export type CheckStatus = "ok" | "down";

export type MeasurementSource = "live" | "placeholder";

export interface DatabaseCheck {
  status: CheckStatus;
  latencyMs: number | null;
  error: string | null;
}

export interface QueueCheck {
  status: CheckStatus;
  depth: number | null;
  source: MeasurementSource;
}

export interface SchedulerCheck {
  status: CheckStatus;
  lagSeconds: number | null;
  source: MeasurementSource;
}

export interface HealthReport {
  status: CheckStatus;
  checkedAt: string;
  database: DatabaseCheck;
  notificationQueue: QueueCheck;
  scheduler: SchedulerCheck;
}

/**
 * Uç noktanın dışarıya verdiği biçim. Sağlık ucu kimlik doğrulaması istemez
 * (dışarıdan izlenebilmesi gerekir, §12.4); bu yüzden veritabanı hata metni
 * dışarı çıkmaz — host, port, kullanıcı adı gibi iç ayrıntılar taşıyabilir.
 * Ayrıntı sunucu günlüğüne yazılır (denetim 17.08.2026, bulgu 14).
 */
export type PublicHealthReport = Omit<HealthReport, "database"> & {
  database: Omit<DatabaseCheck, "error">;
};

export function toPublicReport(report: HealthReport): PublicHealthReport {
  return {
    ...report,
    database: {
      status: report.database.status,
      latencyMs: report.database.latencyMs,
    },
  };
}

export interface HealthProbes {
  /** Veritabanına en ucuz sorguyu atar; hata fırlatırsa bağlantı yok demektir. */
  pingDatabase: () => Promise<unknown>;
  /** Ölçüm anını verir; testte sahte saat bağlanabilsin diye dışarıdan gelir. */
  now: () => Date;
  /** Bekleyen bildirim sayısı. */
  queueDepth?: () => Promise<number>;
  /** En çok gecikmiş işin gecikmesi (saniye) ve gecikme durumu. */
  schedulerLag?: () => Promise<{ lagSeconds: number | null; delayed: boolean }>;
}

async function checkDatabase(probes: HealthProbes): Promise<DatabaseCheck> {
  const startedAt = probes.now().getTime();
  try {
    await probes.pingDatabase();
    return {
      status: "ok",
      latencyMs: probes.now().getTime() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      status: "down",
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkQueue(probes: HealthProbes): Promise<QueueCheck> {
  if (!probes.queueDepth) {
    return { status: "ok", depth: null, source: "placeholder" };
  }

  try {
    return { status: "ok", depth: await probes.queueDepth(), source: "live" };
  } catch {
    // Ölçüm alınamadıysa "sağlıklı" denmez; veritabanı kontrolü zaten durumu
    // yansıtacaktır.
    return { status: "down", depth: null, source: "placeholder" };
  }
}

async function checkScheduler(probes: HealthProbes): Promise<SchedulerCheck> {
  if (!probes.schedulerLag) {
    return { status: "ok", lagSeconds: null, source: "placeholder" };
  }

  try {
    const { lagSeconds, delayed } = await probes.schedulerLag();
    // Gecikme "down" sayılır: zamanlayıcı durduğunda sistem çalışıyor görünür,
    // asıl tehlike budur (§12.4).
    return { status: delayed ? "down" : "ok", lagSeconds, source: "live" };
  } catch {
    return { status: "down", lagSeconds: null, source: "placeholder" };
  }
}

export async function buildHealthReport(
  probes: HealthProbes,
): Promise<HealthReport> {
  const database = await checkDatabase(probes);

  // Veritabanı yoksa diğer ölçümler zaten alınamaz; boş yere denenmez.
  const [notificationQueue, scheduler] =
    database.status === "ok"
      ? await Promise.all([checkQueue(probes), checkScheduler(probes)])
      : ([
          { status: "down", depth: null, source: "placeholder" },
          { status: "down", lagSeconds: null, source: "placeholder" },
        ] as [QueueCheck, SchedulerCheck]);

  const status: CheckStatus =
    database.status === "ok" &&
    notificationQueue.status === "ok" &&
    scheduler.status === "ok"
      ? "ok"
      : "down";

  return {
    status,
    checkedAt: probes.now().toISOString(),
    database,
    notificationQueue,
    scheduler,
  };
}
