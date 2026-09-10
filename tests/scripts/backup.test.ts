import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const GERCEK_BETIK = path.resolve("scripts/backup.sh");

interface Sahne {
  root: string;
  script: string;
  output: string;
  tmp: string;
  dockerLog: string;
  ready: string;
  release: string;
  env: NodeJS.ProcessEnv;
}

interface Kosu {
  child: ChildProcess;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
}

type EnvOverrides = Record<string, string | undefined>;

const sahneler: string[] = [];

afterEach(async () => {
  await Promise.all(
    sahneler.splice(0).map((dizin) => rm(dizin, { recursive: true, force: true })),
  );
});

async function betikYaz(yol: string, icerik: string): Promise<void> {
  await writeFile(yol, icerik, { mode: 0o755 });
  await chmod(yol, 0o755);
}

async function sahneKur(): Promise<Sahne> {
  const root = await mkdtemp(path.join(tmpdir(), "faaliyet-backup-test-"));
  sahneler.push(root);

  const proje = path.join(root, "proje");
  const scripts = path.join(proje, "scripts");
  const bin = path.join(root, "bin");
  const output = path.join(root, "yedek");
  const tmp = path.join(root, "tmp");
  const script = path.join(scripts, "backup.sh");
  const dockerLog = path.join(root, "docker.log");
  const ready = path.join(root, "hazir");
  const release = path.join(root, "birak");

  await Promise.all([
    mkdir(scripts, { recursive: true }),
    mkdir(bin, { recursive: true }),
    mkdir(output, { recursive: true }),
    mkdir(tmp, { recursive: true }),
  ]);
  await copyFile(GERCEK_BETIK, script);
  await chmod(script, 0o755);

  await betikYaz(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\\n' "\${FAKE_RUN_ID:-yok}" "$*" >> "$FAKE_DOCKER_LOG"

if [[ "\${1:-}" == "compose" && "\${2:-}" == "ps" ]]; then
  servis="\${!#}"
  case ",\${FAKE_RUNNING_SERVICES:-}," in
    *",$servis,"*) printf 'fake-%s\\n' "$servis" ;;
  esac
  exit 0
fi

if [[ "\${1:-}" == "compose" && "\${2:-}" == "stop" ]]; then
  servis="\${!#}"
  if [[ "\${FAKE_STOP_FAIL_SERVICE:-}" == "$servis" ]]; then exit 42; fi
  exit 0
fi

if [[ "\${1:-}" == "compose" && "\${2:-}" == "start" ]]; then
  servis="\${!#}"
  if [[ "\${FAKE_START_FAIL_SERVICE:-}" == "$servis" || "\${FAKE_START_FAIL_SERVICE:-}" == "hepsi" ]]; then
    exit 43
  fi
  exit 0
fi

for arg in "$@"; do
  if [[ "$arg" == "pg_dump" ]]; then
    if [[ "\${FAKE_PG_DUMP_FAIL:-0}" == "1" ]]; then exit 44; fi
    if [[ "\${FAKE_BLOCK_RUN_ID:-}" == "\${FAKE_RUN_ID:-}" ]]; then
      : > "$FAKE_READY_FILE"
      for _ in $(seq 1 200); do
        [[ -e "$FAKE_RELEASE_FILE" ]] && break
        sleep 0.05
      done
      [[ -e "$FAKE_RELEASE_FILE" ]] || exit 45
    fi
    printf 'sahte-veritabani-dokumu'
    exit 0
  fi
done

if [[ "\${1:-}" == "compose" && "\${2:-}" == "run" ]]; then
  if [[ "\${FAKE_ARCHIVE_FAIL:-0}" == "1" ]]; then exit 46; fi
  printf 'sahte-birim-arsivi'
  exit 0
fi

exit 0
`,
  );

  await betikYaz(
    path.join(bin, "flock"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-n" ]]; then
  mkdir "$FAKE_FLOCK_DIR" 2>/dev/null || exit 1
  exit 0
fi
if [[ "\${1:-}" == "-u" ]]; then
  rmdir "$FAKE_FLOCK_DIR" 2>/dev/null || true
  exit 0
fi
exit 2
`,
  );

  await betikYaz(
    path.join(bin, "openssl"),
    `#!/usr/bin/env bash
set -euo pipefail
girdi=''
cikti=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -in) girdi="$2"; shift 2 ;;
    -out) cikti="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cp "$girdi" "$cikti"
`,
  );

  // macOS `mktemp -d` çağrısının TMPDIR yorumuna güvenmiyoruz; çalışma
  // dizinini sahnenin içine sabitleyip gerçekten temizlenip temizlenmediğini
  // gözlüyoruz.
  await betikYaz(
    path.join(bin, "mktemp"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-d" ]]; then
  exec /usr/bin/mktemp -d "$FAKE_TMP_PARENT/calisma.XXXXXX"
fi
exec /usr/bin/mktemp "$@"
`,
  );

  return {
    root,
    script,
    output,
    tmp,
    dockerLog,
    ready,
    release,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      BACKUP_PASSPHRASE: "yalniz-test",
      POSTGRES_USER: "test",
      POSTGRES_DB: "test",
      TMPDIR: tmp,
      BACKUP_LOCK_FILE: path.join(proje, ".backup.lock"),
      FAKE_DOCKER_LOG: dockerLog,
      FAKE_FLOCK_DIR: path.join(root, "flock-tutuluyor"),
      FAKE_READY_FILE: ready,
      FAKE_RELEASE_FILE: release,
      FAKE_TMP_PARENT: tmp,
      FAKE_RUNNING_SERVICES: "app,worker",
    },
  };
}

function baslat(
  sahne: Sahne,
  runId: string,
  ekEnv: EnvOverrides = {},
): Kosu {
  const child = spawn("bash", [sahne.script, sahne.output], {
    cwd: path.dirname(path.dirname(sahne.script)),
    env: { ...sahne.env, ...ekEnv, FAKE_RUN_ID: runId },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (parca) => (stdout += String(parca)));
  child.stderr?.on("data", (parca) => (stderr += String(parca)));

  return {
    child,
    done: new Promise((resolve) => {
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    }),
  };
}

async function bitmesiniBekle(
  sahne: Sahne,
  runId = "tek",
  ekEnv: EnvOverrides = {},
) {
  return baslat(sahne, runId, ekEnv).done;
}

async function dosyaBekle(yol: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      await access(yol);
      return;
    } catch {
      await new Promise((coz) => setTimeout(coz, 20));
    }
  }
  throw new Error(`Dosya oluşmadı: ${yol}`);
}

async function dockerCagrilari(sahne: Sahne): Promise<string[]> {
  try {
    return (await readFile(sahne.dockerLog, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

describe("backup.sh yaşam döngüsü", () => {
  it.each([
    ["başarı", {}, 0],
    ["pg_dump hatası", { FAKE_PG_DUMP_FAIL: "1" }, 1],
    ["arşiv hatası", { FAKE_ARCHIVE_FAIL: "1" }, 1],
  ])("%s yolunda açık metin çalışma dizini bırakmaz", async (_ad, env, basarili) => {
    const sahne = await sahneKur();
    const sonuc = await bitmesiniBekle(sahne, "temizlik", env);

    if (basarili === 0) expect(sonuc.code).toBe(0);
    else expect(sonuc.code).not.toBe(0);
    expect(await readdir(sahne.tmp)).toEqual([]);
  });

  it("servis yeniden başlatılamazsa yedeği başarılı saymaz", async () => {
    const sahne = await sahneKur();
    const sonuc = await bitmesiniBekle(sahne, "start-hatasi", {
      FAKE_START_FAIL_SERVICE: "app",
    });

    expect(sonuc.code).not.toBe(0);
    expect(sonuc.stderr).toContain("başlatılamadı");
  });

  it("başlangıçta kapalı servisi durdurmaz veya başlatmaz", async () => {
    const sahne = await sahneKur();
    const sonuc = await bitmesiniBekle(sahne, "durum", {
      FAKE_RUNNING_SERVICES: "worker",
    });

    expect(sonuc.code).toBe(0);
    const cagrilar = await dockerCagrilari(sahne);
    expect(cagrilar.some((satir) => satir.includes("compose stop app"))).toBe(false);
    expect(cagrilar.some((satir) => satir.includes("compose start app"))).toBe(false);
    expect(cagrilar.some((satir) => satir.includes("compose stop worker"))).toBe(true);
    expect(cagrilar.some((satir) => satir.includes("compose start worker"))).toBe(true);
  });

  it("kısmi stop hatasında daha önce duran servisi geri açar", async () => {
    const sahne = await sahneKur();
    const sonuc = await bitmesiniBekle(sahne, "stop-hatasi", {
      FAKE_STOP_FAIL_SERVICE: "worker",
    });

    expect(sonuc.code).not.toBe(0);
    const cagrilar = await dockerCagrilari(sahne);
    expect(cagrilar.some((satir) => satir.includes("compose stop app"))).toBe(true);
    expect(cagrilar.some((satir) => satir.includes("compose start app"))).toBe(true);
  });

  it("devam eden yedekte ikinci koşuyu servislere dokunmadan reddeder", async () => {
    const sahne = await sahneKur();
    const ilk = baslat(sahne, "ilk", {
      FAKE_BLOCK_RUN_ID: "ilk",
    });

    try {
      await dosyaBekle(sahne.ready);

      const ikinci = await bitmesiniBekle(sahne, "ikinci");
      expect(ikinci.code).not.toBe(0);
      expect(`${ikinci.stdout}\n${ikinci.stderr}`).toMatch(/başka bir yedek/i);

      const ikinciCagrilari = (await dockerCagrilari(sahne)).filter((satir) =>
        satir.startsWith("ikinci|"),
      );
      expect(
        ikinciCagrilari.some(
          (satir) => satir.includes("compose stop") || satir.includes("compose start"),
        ),
      ).toBe(false);
    } finally {
      await writeFile(sahne.release, "devam");
      const ilkSonuc = await ilk.done;
      expect(ilkSonuc.code).toBe(0);
    }
  });
});
