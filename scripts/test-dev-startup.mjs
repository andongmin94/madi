import {
  execFileSync,
  spawn,
} from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
const isolatedDesktop = Boolean(process.env.MADI_ISOLATED_GATE_RUN_DIR?.trim());
const command = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
const args = isWindows
  ? ["/d", "/s", "/c", "npm run dev"]
  : ["run", "dev"];
const child = spawn(command, args, {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let finished = false;
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function plainOutput() {
  return output.replace(/\u001b\[[0-9;]*m/g, "");
}

async function waitForVite() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `npm run dev exited before Vite became ready: ${output.slice(-2_000)}`,
      );
    }
    if (/Local:\s+http:\/\/127\.0\.0\.1:5173/i.test(plainOutput())) {
      return;
    }
    await wait(200);
  }
  throw new Error(`npm run dev did not become ready: ${output.slice(-2_000)}`);
}

function observeElectronDescendant(rootProcessId) {
  if (!isWindows) {
    return {
      electronProcess: true,
      browserProcessCount: null,
      disableGpuSwitchObserved: null,
    };
  }
  const script = [
    `$rootProcessId = ${rootProcessId}`,
    "$pending = [System.Collections.Generic.Queue[int]]::new()",
    "$pending.Enqueue($rootProcessId)",
    "$browserCount = 0",
    "$disabledBrowserCount = 0",
    "while ($pending.Count -gt 0) {",
    "  $parent = $pending.Dequeue()",
    "  foreach ($process in Get-CimInstance Win32_Process -Filter \"ParentProcessId=$parent\") {",
    "    if ($process.Name -ieq 'electron.exe' -and $process.CommandLine -notmatch '--type=') {",
    "      $browserCount++",
    "      if ($process.CommandLine -match '(?:^|\\s)--disable-gpu(?:\\s|$)') { $disabledBrowserCount++ }",
    "    }",
    "    $pending.Enqueue([int]$process.ProcessId)",
    "  }",
    "}",
    "[pscustomobject]@{ electronProcess = ($browserCount -gt 0); browserProcessCount = $browserCount; disableGpuSwitchObserved = if ($browserCount -gt 0) { $disabledBrowserCount -eq $browserCount } else { $null } } | ConvertTo-Json -Compress",
  ].join("\n");
  const result = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return JSON.parse(result);
}

try {
  await waitForVite();
  await wait(5_000);
  if (child.exitCode !== null) {
    throw new Error(
      `npm run dev exited during the startup hold: ${output.slice(-2_000)}`,
    );
  }
  const electronRuntime = observeElectronDescendant(child.pid);
  if (!electronRuntime.electronProcess) {
    throw new Error(
      `npm run dev did not launch Electron: ${output.slice(-2_000)}`,
    );
  }
  if (isolatedDesktop && electronRuntime.disableGpuSwitchObserved !== true) {
    throw new Error("npm run dev isolated Electron browser did not disable GPU");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "npm run dev",
        rustDebugBuild: /Finished `dev` profile/.test(output),
        viteDevelopmentServer: "http://127.0.0.1:5173",
        ...electronRuntime,
        startupHoldSeconds: 5,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (!finished && child.exitCode === null) {
    if (isWindows) {
      try {
        execFileSync(
          "taskkill.exe",
          ["/pid", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
      } catch {
        child.kill();
      }
    } else {
      child.kill("SIGTERM");
    }
  }
  finished = true;
}
