import {
  execFileSync,
  spawn,
} from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
const command = isWindows ? process.env.ComSpec || "cmd.exe" : "pnpm";
const args = isWindows
  ? ["/d", "/s", "/c", "pnpm dev"]
  : ["dev"];
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
        `pnpm dev exited before Vite became ready: ${output.slice(-2_000)}`,
      );
    }
    if (/Local:\s+http:\/\/127\.0\.0\.1:5173/i.test(plainOutput())) {
      return;
    }
    await wait(200);
  }
  throw new Error(`pnpm dev did not become ready: ${output.slice(-2_000)}`);
}

function hasElectronDescendant(rootProcessId) {
  if (!isWindows) {
    return true;
  }
  const script = [
    `$rootProcessId = ${rootProcessId}`,
    "$pending = [System.Collections.Generic.Queue[int]]::new()",
    "$pending.Enqueue($rootProcessId)",
    "$found = $false",
    "while ($pending.Count -gt 0) {",
    "  $parent = $pending.Dequeue()",
    "  foreach ($process in Get-CimInstance Win32_Process -Filter \"ParentProcessId=$parent\") {",
    "    if ($process.Name -ieq 'electron.exe') { $found = $true }",
    "    $pending.Enqueue([int]$process.ProcessId)",
    "  }",
    "}",
    "Write-Output $found",
  ].join("\n");
  const result = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return result.trim().toLocaleLowerCase() === "true";
}

try {
  await waitForVite();
  await wait(5_000);
  if (child.exitCode !== null) {
    throw new Error(
      `pnpm dev exited during the startup hold: ${output.slice(-2_000)}`,
    );
  }
  if (!hasElectronDescendant(child.pid)) {
    throw new Error(
      `pnpm dev did not launch Electron: ${output.slice(-2_000)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "pnpm dev",
        rustDebugBuild: /Finished `dev` profile/.test(output),
        viteDevelopmentServer: "http://127.0.0.1:5173",
        electronProcess: true,
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
