import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const MAXIMUM_REGISTRY_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_FONT_ENTRIES = 20_000;
const FONT_QUERY_TIMEOUT_MS = 2_500;

const FONT_REGISTRY_SCRIPT = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$paths = @(
  'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts',
  'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
)
$names = @()
foreach ($registryPath in $paths) {
  if (Test-Path -LiteralPath $registryPath) {
    $item = Get-ItemProperty -LiteralPath $registryPath
    foreach ($property in $item.PSObject.Properties) {
      if (-not $property.Name.StartsWith('PS')) {
        $names += $property.Name
      }
    }
  }
}
ConvertTo-Json -InputObject @($names) -Compress
`.trim();

export interface FontInstallationPort {
  isInstalled(fontFamily: string): Promise<boolean | null>;
}

function normalizedFontName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function registryFontFamilies(value: string): readonly string[] {
  const withoutTechnology = value.replace(/\s+\([^()]{1,64}\)\s*$/u, "").trim();
  return withoutTechnology
    .split(/\s+&\s+/u)
    .map(normalizedFontName)
    .filter((name) => name.length > 0);
}

function queryRegistryFontNames(
  powershellPath: string
): Promise<readonly string[] | null> {
  return new Promise((resolve) => {
    execFile(
      powershellPath,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        FONT_REGISTRY_SCRIPT
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: FONT_QUERY_TIMEOUT_MS,
        maxBuffer: MAXIMUM_REGISTRY_OUTPUT_BYTES
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
          const values = typeof parsed === "string" ? [parsed] : parsed;
          if (
            !Array.isArray(values) ||
            values.length > MAXIMUM_FONT_ENTRIES ||
            values.some(
              (entry) =>
                typeof entry !== "string" ||
                entry.length < 1 ||
                entry.length > 512 ||
                /[\u0000-\u001f\u007f]/u.test(entry)
            )
          ) {
            resolve(null);
            return;
          }
          resolve(values as string[]);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

async function fontDirectoryNames(
  fontsDirectory: string
): Promise<readonly string[] | null> {
  try {
    const entries = await readdir(fontsDirectory, { withFileTypes: true });
    if (entries.length > MAXIMUM_FONT_ENTRIES) {
      return null;
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => normalizedFontName(path.parse(entry.name).name));
  } catch {
    return null;
  }
}

export class WindowsFontInstallationDetector implements FontInstallationPort {
  private readonly cache = new Map<string, Promise<boolean | null>>();

  public isInstalled(fontFamily: string): Promise<boolean | null> {
    const normalized = normalizedFontName(fontFamily);
    if (normalized.length < 1 || normalized.length > 128) {
      return Promise.resolve(null);
    }
    if (process.platform !== "win32") {
      return Promise.resolve(null);
    }
    const cached = this.cache.get(normalized);
    if (cached) {
      return cached;
    }
    const check = this.inspect(normalized);
    this.cache.set(normalized, check);
    return check;
  }

  private async inspect(normalizedFamily: string): Promise<boolean | null> {
    const systemRoot = process.env.SystemRoot?.trim() || "C:\\Windows";
    const powershellPath = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const [registryNames, fileNames] = await Promise.all([
      queryRegistryFontNames(powershellPath),
      fontDirectoryNames(path.join(systemRoot, "Fonts"))
    ]);
    if (
      registryNames?.some((name) =>
        registryFontFamilies(name).includes(normalizedFamily)
      ) ||
      fileNames?.includes(normalizedFamily)
    ) {
      return true;
    }
    return registryNames === null ? null : false;
  }
}
