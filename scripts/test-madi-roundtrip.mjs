import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstance } from '../packages/typie-runtime/browser/editor_ffi.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const executableName = process.platform === 'win32' ? 'madi-core.exe' : 'madi-core';
const coreBinary =
  process.env.MADI_CORE_BIN?.trim() ||
  resolve(repositoryRoot, 'crates', 'madi-core', 'target', 'debug', executableName);

const runCore = (args) => {
  const result = spawnSync(coreBinary, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = result.error instanceof Error ? `: ${result.error.message}` : '';
    throw new Error(`madi-core ${args[0]} failed with status ${String(result.status)}${detail}`);
  }
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : undefined;
};

const dispatch = (editor, messages) => {
  const requestId = editor.enqueue_request(messages);
  const tick = editor.tick_through(requestId);
  const outcome = tick.request_outcomes.find((candidate) => candidate.request_id.value === requestId.value);
  if (outcome?.command_outcomes.some((candidate) => candidate.type === 'rejected')) {
    throw new Error('Typie rejected an integration fixture command');
  }
};

const buildTypieFixture = async () => {
  const wasmPath = fileURLToPath(
    new URL('../packages/typie-runtime/browser/editor_ffi_bg.wasm', import.meta.url),
  );
  const icuPath = fileURLToPath(
    new URL('../packages/typie-runtime/browser/icu.zst', import.meta.url),
  );
  const [wasmBytes, icuData] = await Promise.all([readFile(wasmPath), readFile(icuPath)]);
  const { EditorHost } = await createInstance(await WebAssembly.compile(wasmBytes));
  const host = EditorHost.create(icuData);
  const editor = host.create_editor_from_doc(
    {
      root: {
        node: { type: 'root', layout_mode: { type: 'continuous', max_width: 720 } },
        modifiers: {},
        carry: [],
        children: [
          {
            node: { type: 'paragraph' },
            modifiers: {},
            carry: [],
            children: [],
          },
        ],
      },
    },
    { width: 760, height: 560, scale_factor: 1 },
  );

  dispatch(editor, [
    { type: 'system', event: { type: 'initialize' } },
    { type: 'selection', op: { type: 'set_flat', start: 1, end: 1 } },
  ]);
  dispatch(editor, [
    { type: 'insertion', op: { type: 'text', text: '용은 오래된 산맥 위를 날았다.' } },
  ]);
  dispatch(editor, [
    {
      type: 'insertion',
      op: {
        type: 'fragment',
        fragment: {
          node: { type: 'horizontal_rule', variant: 'three_diamonds' },
        },
      },
    },
  ]);
  dispatch(editor, [
    { type: 'insertion', op: { type: 'text', text: '두 번째 장면이 시작되었다.' } },
  ]);

  const extracted = editor.missing_changesets_tolerant(new Uint8Array());
  if (extracted.withheld !== 0 || extracted.bytes.byteLength === 0) {
    throw new Error('Typie fixture snapshot extraction failed');
  }
  const fixture = {
    snapshot: new Uint8Array(extracted.bytes),
    plainText: editor.prose_text_annotated(),
  };
  editor.free();
  host.free();
  return fixture;
};

const workspace = await mkdtemp(join(tmpdir(), 'madi-roundtrip-'));
const projectPath = join(workspace, '드래곤을죽이다.madi');
const snapshotPath = join(workspace, 'fixture.snapshot');
const recoveryPath = join(workspace, 'fixture.txt');
const documentId = 'phase0-document';

try {
  const fixture = await buildTypieFixture();
  await Promise.all([
    writeFile(snapshotPath, fixture.snapshot),
    writeFile(recoveryPath, fixture.plainText, 'utf8'),
  ]);

  runCore([
    'create-project',
    '--file-path',
    projectPath,
    '--title',
    '드래곤을죽이다',
    '--document-id',
    documentId,
    '--editor-engine',
    'typie',
    '--editor-engine-commit',
    'fbe5c4bf860d1717a66e66bea2374a2e39f0dd26',
    '--editor-schema-version',
    '1',
  ]);

  runCore([
    'save-document',
    '--file-path',
    projectPath,
    '--document-id',
    documentId,
    '--title',
    '본문',
    '--editor-engine',
    'typie',
    '--editor-engine-commit',
    'fbe5c4bf860d1717a66e66bea2374a2e39f0dd26',
    '--editor-schema-version',
    '1',
    '--snapshot-file',
    snapshotPath,
    '--plain-text-file',
    recoveryPath,
    '--expected-revision',
    '0',
  ]);

  // Every invocation above has exited. These fresh processes exercise reopen
  // and recovery without an Electron renderer or a live sidecar.
  const loaded = runCore([
    'load-document',
    '--file-path',
    projectPath,
    '--document-id',
    documentId,
  ]);
  const recovered = runCore([
    'recover-plain-text',
    '--file-path',
    projectPath,
    '--document-id',
    documentId,
    '--json',
  ]);
  const inspected = runCore(['inspect-project', '--file-path', projectPath]);

  const restoredSnapshot = Buffer.from(loaded.snapshot_base64, 'base64');
  const expectedHash = createHash('sha256').update(fixture.snapshot).digest('hex');
  const restoredHash = createHash('sha256').update(restoredSnapshot).digest('hex');
  const header = (await readFile(projectPath)).subarray(0, 16).toString('binary');

  if (expectedHash !== restoredHash) {
    throw new Error('Snapshot SHA-256 changed after the process restart');
  }
  if (recovered.plain_text_recovery !== fixture.plainText) {
    throw new Error('Plain-text recovery changed after the process restart');
  }
  if (header !== 'SQLite format 3\u0000') {
    throw new Error('The .madi fixture is not a SQLite file');
  }
  if (inspected.application_id !== 0x4d414449 || inspected.integrity_check !== 'ok') {
    throw new Error('The .madi metadata or integrity check is invalid');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        fileName: '드래곤을죽이다.madi',
        sqlite: true,
        applicationId: inspected.application_id,
        snapshotBytes: fixture.snapshot.byteLength,
        snapshotSha256: restoredHash,
        plainTextBytes: Buffer.byteLength(fixture.plainText, 'utf8'),
        sceneBreakRecovered: fixture.plainText.includes('\n\n***\n\n'),
        processRestartRoundTrip: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  const safePrefix = resolve(tmpdir());
  const resolvedWorkspace = resolve(workspace);
  if (resolvedWorkspace.startsWith(`${safePrefix}\\`) || resolvedWorkspace.startsWith(`${safePrefix}/`)) {
    await rm(resolvedWorkspace, { recursive: true, force: true });
  }
}
