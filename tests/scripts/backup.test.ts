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

const REAL_SCRIPT = path.resolve("scripts/backup.sh");

interface Setup {
  root: string;
  script: string;
  output: string;
  tmp: string;
  dockerLog: string;
  ready: string;
  release: string;
  env: NodeJS.ProcessEnv;
}

interface Run {
  child: ChildProcess;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
}

type EnvOverrides = Record<string, string | undefined>;

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writeScript(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { mode: 0o755 });
  await chmod(filePath, 0o755);
}

async function setupScenario(): Promise<Setup> {
  const root = await mkdtemp(path.join(tmpdir(), "acta-backup-test-"));
  testDirs.push(root);

  const project = path.join(root, "project");
  const scripts = path.join(project, "scripts");
  const bin = path.join(root, "bin");
  const output = path.join(root, "backup");
  const tmp = path.join(root, "tmp");
  const script = path.join(scripts, "backup.sh");
  const dockerLog = path.join(root, "docker.log");
  const ready = path.join(root, "ready");
  const release = path.join(root, "release");

  await Promise.all([
    mkdir(scripts, { recursive: true }),
    mkdir(bin, { recursive: true }),
    mkdir(output, { recursive: true }),
    mkdir(tmp, { recursive: true }),
  ]);
  await copyFile(REAL_SCRIPT, script);
  await chmod(script, 0o755);

  await writeScript(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\\n' "\${FAKE_RUN_ID:-none}" "$*" >> "$FAKE_DOCKER_LOG"

if [[ "\${1:-}" == "compose" && "\${2:-}" == "ps" ]]; then
  service="\${!#}"
  case ",\${FAKE_RUNNING_SERVICES:-}," in
    *",$service,"*) printf 'fake-%s\\n' "$service" ;;
  esac
  exit 0
fi

if [[ "\${1:-}" == "compose" && "\${2:-}" == "stop" ]]; then
  service="\${!#}"
  if [[ "\${FAKE_STOP_FAIL_SERVICE:-}" == "$service" ]]; then exit 42; fi
  exit 0
fi

if [[ "\${1:-}" == "compose" && "\${2:-}" == "start" ]]; then
  service="\${!#}"
  if [[ "\${FAKE_START_FAIL_SERVICE:-}" == "$service" || "\${FAKE_START_FAIL_SERVICE:-}" == "all" ]]; then
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
    printf 'fake-database-dump'
    exit 0
  fi
done

if [[ "\${1:-}" == "compose" && "\${2:-}" == "run" ]]; then
  if [[ "\${FAKE_ARCHIVE_FAIL:-0}" == "1" ]]; then exit 46; fi
  printf 'fake-volume-archive'
  exit 0
fi

exit 0
`,
  );

  await writeScript(
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

  await writeScript(
    path.join(bin, "openssl"),
    `#!/usr/bin/env bash
set -euo pipefail
input=''
output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -in) input="$2"; shift 2 ;;
    -out) output="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cp "$input" "$output"
`,
  );

  // We do not trust macOS mktemp -d interpretation of TMPDIR; fixing the working
  // directory inside the fixture and watching whether it is truly cleaned up.
  await writeScript(
    path.join(bin, "mktemp"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-d" ]]; then
  exec /usr/bin/mktemp -d "$FAKE_TMP_PARENT/work.XXXXXX"
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
      BACKUP_PASSPHRASE: "test-only",
      POSTGRES_USER: "test",
      POSTGRES_DB: "test",
      TMPDIR: tmp,
      BACKUP_LOCK_FILE: path.join(project, ".backup.lock"),
      FAKE_DOCKER_LOG: dockerLog,
      FAKE_FLOCK_DIR: path.join(root, "flock-held"),
      FAKE_READY_FILE: ready,
      FAKE_RELEASE_FILE: release,
      FAKE_TMP_PARENT: tmp,
      FAKE_RUNNING_SERVICES: "app,worker",
    },
  };
}

function startRun(
  setup: Setup,
  runId: string,
  extraEnv: EnvOverrides = {},
): Run {
  const child = spawn("bash", [setup.script, setup.output], {
    cwd: path.dirname(path.dirname(setup.script)),
    env: { ...setup.env, ...extraEnv, FAKE_RUN_ID: runId },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));

  return {
    child,
    done: new Promise((resolve) => {
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    }),
  };
}

async function waitForCompletion(
  setup: Setup,
  runId = "single",
  extraEnv: EnvOverrides = {},
) {
  return startRun(setup, runId, extraEnv).done;
}

async function waitForFile(filePath: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`File was not created: ${filePath}`);
}

async function getDockerCalls(setup: Setup): Promise<string[]> {
  try {
    return (await readFile(setup.dockerLog, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

describe("backup.sh lifecycle", () => {
  it.each([
    ["success", {}, 0],
    ["pg_dump error", { FAKE_PG_DUMP_FAIL: "1" }, 1],
    ["archive error", { FAKE_ARCHIVE_FAIL: "1" }, 1],
  ])("does not leave plain text working directory in %s path", async (_name, env, expectedCode) => {
    const setup = await setupScenario();
    const result = await waitForCompletion(setup, "cleanup", env);

    if (expectedCode === 0) expect(result.code).toBe(0);
    else expect(result.code).not.toBe(0);
    expect(await readdir(setup.tmp)).toEqual([]);
  });

  it("does not treat backup as successful if service cannot be restarted", async () => {
    const setup = await setupScenario();
    const result = await waitForCompletion(setup, "start-error", {
      FAKE_START_FAIL_SERVICE: "app",
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("could not restart");
  });

  it("does not stop or start service that was initially stopped", async () => {
    const setup = await setupScenario();
    const result = await waitForCompletion(setup, "status", {
      FAKE_RUNNING_SERVICES: "worker",
    });

    expect(result.code).toBe(0);
    const calls = await getDockerCalls(setup);
    expect(calls.some((line) => line.includes("compose stop app"))).toBe(false);
    expect(calls.some((line) => line.includes("compose start app"))).toBe(false);
    expect(calls.some((line) => line.includes("compose stop worker"))).toBe(true);
    expect(calls.some((line) => line.includes("compose start worker"))).toBe(true);
  });

  it("restarts previously stopped service on partial stop error", async () => {
    const setup = await setupScenario();
    const result = await waitForCompletion(setup, "stop-error", {
      FAKE_STOP_FAIL_SERVICE: "worker",
    });

    expect(result.code).not.toBe(0);
    const calls = await getDockerCalls(setup);
    expect(calls.some((line) => line.includes("compose stop app"))).toBe(true);
    expect(calls.some((line) => line.includes("compose start app"))).toBe(true);
  });

  it("rejects second run during ongoing backup without touching services", async () => {
    const setup = await setupScenario();
    const first = startRun(setup, "first", {
      FAKE_BLOCK_RUN_ID: "first",
    });

    try {
      await waitForFile(setup.ready);

      const second = await waitForCompletion(setup, "second");
      expect(second.code).not.toBe(0);
      expect(`${second.stdout}\n${second.stderr}`).toMatch(/another backup/i);

      const secondCalls = (await getDockerCalls(setup)).filter((line) =>
        line.startsWith("second|"),
      );
      expect(
        secondCalls.some(
          (line) => line.includes("compose stop") || line.includes("compose start"),
        ),
      ).toBe(false);
    } finally {
      await writeFile(setup.release, "continue");
      const firstResult = await first.done;
      expect(firstResult.code).toBe(0);
    }
  });
});
