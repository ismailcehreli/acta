

//




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

  pingDatabase: () => Promise<unknown>;

  now: () => Date;

  queueDepth?: () => Promise<number>;

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


    return { status: "down", depth: null, source: "placeholder" };
  }
}

async function checkScheduler(probes: HealthProbes): Promise<SchedulerCheck> {
  if (!probes.schedulerLag) {
    return { status: "ok", lagSeconds: null, source: "placeholder" };
  }

  try {
    const { lagSeconds, delayed } = await probes.schedulerLag();


    return { status: delayed ? "down" : "ok", lagSeconds, source: "live" };
  } catch {
    return { status: "down", lagSeconds: null, source: "placeholder" };
  }
}

export async function buildHealthReport(
  probes: HealthProbes,
): Promise<HealthReport> {
  const database = await checkDatabase(probes);


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
