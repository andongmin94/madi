import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IME_MANUAL_CHECKS,
  buildImeReport,
  createInitialImeResults,
  createInitialManualEnvironment,
  serializeImeReportJson,
  serializeImeReportMarkdown,
} from "../apps/desktop/src/renderer/components/imeManualResults.ts";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function requireValue(value, code) {
  if (!value) throw Object.assign(new Error(), { preparationCode: code });
}
function containedPath(name) {
  const target = resolve(repositoryRoot, name);
  const rel = relative(repositoryRoot, target);
  requireValue(!isAbsolute(name) && rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "PATH_ESCAPE");
  return target;
}
async function directory(name) {
  const parts = relative(repositoryRoot, containedPath(name)).split(sep);
  let current = repositoryRoot;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    requireValue(info.isDirectory() && !info.isSymbolicLink(), "DIRECTORY_NOT_REGULAR");
  }
}
async function regularFile(name) {
  const target = containedPath(name);
  const parts = relative(repositoryRoot, target).split(sep);
  let current = repositoryRoot;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    const info = await lstat(current);
    requireValue(!info.isSymbolicLink() && (index === parts.length - 1 ? info.isFile() : info.isDirectory()), "SOURCE_NOT_REGULAR");
  }
  return target;
}
function sourceState() {
  const options = { cwd: repositoryRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] };
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
    workingTreeClean: execFileSync("git", ["status", "--porcelain"], options).trim() === "",
  };
}
async function fileIdentity(name) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(await regularFile(name))) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { path: name, bytes, sha256: hash.digest("hex") };
}

try {
  const before = sourceState();
  requireValue(/^[a-f0-9]{40}$/.test(before.commit), "INVALID_SOURCE_COMMIT");
  const kitPath = `output/releases/manual-validation/${before.commit.slice(0, 7)}-${randomUUID()}`;
  await directory("output/releases/manual-validation");
  await mkdir(containedPath(kitPath));
  const files = [];
  const copiedSources = [];
  async function artifact(name, value) {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    const parent = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    if (parent) await directory(`${kitPath}/${parent}`);
    await writeFile(containedPath(`${kitPath}/${name}`), bytes, { flag: "wx" });
    files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  for (const source of [
    "docs/MANUAL_KOREAN_IME_CHECKLIST.md",
  ]) {
    const bytes = await readFile(await regularFile(source));
    await artifact(source, bytes);
    copiedSources.push({ source, bytes: bytes.length, sha256: sha256(bytes), byteExactCopy: true });
  }
  const sentence = "용은 오래된 산맥 위를 날았다. 바람은 잔잔했고 숲은 고요했다.";
  const paragraphCount = 200;
  const text = `${sentence}\n`.repeat(paragraphCount);
  const characterCount = [...text].length;
  const koreanCharacterCount = [...text].filter((character) => /[가-힣]/u.test(character)).length;
  requireValue(characterCount >= 5_000 && koreanCharacterCount >= 5_000, "SYNTHETIC_TEXT_TOO_SHORT");
  await artifact("korean-input-long.txt", text);
  const imeReport = buildImeReport(
    createInitialImeResults(),
    { ...createInitialManualEnvironment(), appVersion: "", typieCommit: "", editorSchemaVersion: 0, platform: "", userAgent: "" },
    null,
  );
  requireValue(IME_MANUAL_CHECKS.length === 15 && Object.values(imeReport.results).every((result) => result === "NOT TESTED"), "MANUAL_RESULTS_NOT_BLANK");
  await artifact("ime-results-template.json", serializeImeReportJson(imeReport));
  await artifact("ime-results-template.md", serializeImeReportMarkdown(imeReport));
  const referenceSources = [];
  for (const source of ["apps/desktop/src/renderer/components/imeManualResults.ts", "scripts/prepare-manual-validation.mjs"]) {
    referenceSources.push(await fileIdentity(source));
  }
  const appExecutable = await fileIdentity("output/madi-win32-x64/madi.exe");
  const packagedAppMetadata = await fileIdentity("output/madi-win32-x64/resources/app/package.json");
  const userDataPath = `${kitPath}/user-data`;
  const windowsUserDataPath = userDataPath.replaceAll("/", "\\");
  await artifact("expected-coverage.md", `# 합성 입력의 기대 범위\n\n이 파일은 시험 자료이며 실제 검사 결과가 아니다.\n\n- UTF-8/LF 원문: korean-input-long.txt\n- 문단: ${paragraphCount}개, 각 문단은 같은 합성 문장\n- Unicode code points: ${characterCount} (마지막 LF 포함)\n- Hangul syllables: ${koreanCharacterCount}\n- 파일 SHA-256: ${sha256(Buffer.from(text, "utf8"))}\n\n복사·붙여넣기 후 첫 문단·마지막 문단·순서·문단 분리를 사람이 확인한다. 마지막 newline의 editor 정규화는 별도로 기록한다. 원문 파일 hash를 editor snapshot hash와 같다고 가정하지 않는다. 실제 한국어 조합 검사는 체크리스트의 짧은 문장을 키보드로 입력한다.\n`);
  await artifact("README.md", `# madi 수동 검증 준비물\n\n상태: PREPARED / NOT TESTED. 실제 PASS 또는 배포 허가가 아니다.\n\n## 한국어 IME 시험\n\n1. 사람이 컴퓨터를 시험할 수 있을 때 저장소 루트에서 아래 명령으로 기존 앱을 직접 실행한다. 준비 script는 앱·창을 열지 않는다.\n2. 한국어 IME 체크 → 테스트용 빈 문서 생성으로 시험용 .madi를 만든다. 사용자 원고를 열지 않는다.\n3. 수동 시험 환경 7개 필드를 실제 값으로 채우고 docs/MANUAL_KOREAN_IME_CHECKLIST.md의 15개 항목을 수행한다.\n4. korean-input-long.txt는 5,000자 이상 합성 붙여넣기 자료다. native 조합·후보창은 사람이 실제 키보드로 확인한다.\n5. 사람이 확인한 항목만 PASS/FAIL로 기록한다. snapshot 저장 완료 → 앱 완전 종료 → 같은 user-data와 .madi로 재실행한다.\n6. 앱의 결과 JSON/Markdown 내보내기를 보관한다. 이 kit의 template 파일을 실제 결과로 제출하지 않는다. template 환경의 빈 문자열과 editorSchemaVersion0은 미기록 표시다.\n\n사용자가 직접 실행하는 PowerShell 명령 (현재 저장소 루트):\n\n\`\`\`powershell\n& '.\\output\\madi-win32-x64\\madi.exe' ('--user-data-dir=' + [System.IO.Path]::GetFullPath('.\\${windowsUserDataPath}'))\n\`\`\`\n\n기존 Electron --user-data-dir flag를 사용해 평소 profile/checklist/AI 설정과 분리한다. 재실행 때 같은 명령을 사용한다. 새 IME 결과는 전부 NOT TESTED로 시작한다. 앱이 창을 표시하므로 사용자가 편한 시점에 직접 실행한다.\n\n## 기록과 identity\n\nmanifest.json은 준비 source와 관측 파일 hash다. app executable hash는 새 actual 성공이나 전체 package provenance를 증명하지 않는다. 실제 시험 보고서에는 사용한 build/source와 환경을 함께 기록한다.\n원고·키·private path를 결과 로그에 넣지 않는다. 합성 문장만 사용한다. 공개·유료·고객·installer 배포 승인과 구분한다.\n`);
  const after = sourceState();
  requireValue(after.commit === before.commit, "SOURCE_COMMIT_CHANGED");
  for (const source of copiedSources) {
    requireValue(sha256(await readFile(await regularFile(source.source))) === source.sha256, "SOURCE_DOCUMENT_CHANGED");
  }
  const manifest = {
    schemaVersion: 1,
    purpose: "MANUAL_VALIDATION_PREPARATION_ONLY",
    status: "PREPARED_NOT_VALIDATED",
    validationPerformed: false,
    recordedUtc: new Date().toISOString(),
    sourceBefore: before,
    sourceAfter: after,
    kitPath,
    nodeVersion: process.version,
    syntheticInputOnly: true,
    imeCheckCount: 15,
    imeNotTestedCount: 15,
    manualEnvironmentRecorded: false,
    appLaunched: false,
    appExecutable,
    packagedAppMetadata,
    userDataPath,
    copiedSources,
    referenceSources,
    inputCoverage: { unicodeCodePoints: characterCount, hangulSyllables: koreanCharacterCount, paragraphs: paragraphCount },
    files,
  };
  await artifact("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: manifest.status, kitPath, files: files.length, imeNotTested: 15, koreanCharacters: koreanCharacterCount, validationPerformed: false, appLaunched: false }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "PREPARATION_FAILED", code: error.preparationCode ?? "SOURCE_OR_OUTPUT_IO_ERROR" })}\n`);
  process.exitCode = 1;
}
