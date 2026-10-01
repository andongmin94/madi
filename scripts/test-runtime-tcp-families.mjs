import net from "node:net";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const runFile = promisify(execFile);
const TIMEOUT_MS = 10_000;
const servers = [];
const sockets = [];
const sources = [];
const observations = [];
const startedUtc = new Date().toISOString();
let failureCode = null;
let cleanupCode = null;
let socketsCleaned = false;
let sourceUnchanged = false;

function verify(value, code) {
  if (!value) throw Object.assign(new Error(), { safeCode: code });
}

function bounded(operation, code) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error(), { safeCode: code })),
        TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function fixture(host) {
  const server = net.createServer();
  servers.push(server);
  const accepted = new Promise((ready, fail) => {
    server.once("error", fail);
    server.once("connection", (socket) => {
      sockets.push(socket);
      socket.on("error", () => undefined);
      ready();
    });
  });
  // Attach rejection handling before listening so setup failure remains handled.
  const acceptedReady = bounded(accepted, "CANARY_ACCEPT_TIMEOUT");
  acceptedReady.catch(() => undefined);
  await bounded(
    new Promise((ready, fail) => {
      server.once("error", fail);
      server.listen(0, host, ready);
    }),
    "CANARY_LISTEN_TIMEOUT",
  );
  const address = server.address();
  verify(address && typeof address !== "string", "CANARY_LISTENER_INVALID");
  const client = net.createConnection({ host, port: address.port });
  sockets.push(client);
  await bounded(
    new Promise((ready, fail) => {
      client.once("error", fail);
      client.once("connect", ready);
    }),
    "CANARY_CONNECT_TIMEOUT",
  );
  await acceptedReady;
  return { host, port: address.port };
}

function endpoint(value) {
  const bracketed = value.startsWith("[");
  const split = bracketed ? value.indexOf("]:") : value.lastIndexOf(":");
  verify(split > 0, "TCP_ENDPOINT_INVALID");
  const address = bracketed ? value.slice(1, split) : value.slice(0, split);
  const port = Number(value.slice(split + (bracketed ? 2 : 1)));
  verify(Number.isInteger(port) && port >= 0 && port <= 65535, "TCP_PORT_INVALID");
  return { address, port };
}

async function readCollector(path, phase) {
  verify(path.endsWith(".mjs"), "CANARY_SOURCE_INVALID");
  const bytes = await readFile(path);
  const blocks = [...bytes.toString("utf8").matchAll(/String\.raw`([^`]+)`/gu)];
  const commands = blocks.flatMap((block) => [
    ...block[1].matchAll(/\$(phase1[gh])NetstatRows = @\(& \$\1Netstat ([^;)]+)\);/gu),
  ]);
  verify(commands.length === 1 && commands[0][1] === phase, "EXACT_COLLECTOR_COMMAND_REQUIRED");
  const args = commands[0][2].trim().split(/\s+/u);
  // These are allowed extracted arguments, not a replacement collector command.
  verify(
    JSON.stringify(args) === '["-ano"]' ||
      JSON.stringify(args) === '["-ano","-p","tcp"]',
    "CLOSED_NETSTAT_ARGUMENTS_REQUIRED",
  );
  return { path, phase, bytes, args };
}

async function collect(source, canaries) {
  const sampleStart = Date.now();
  const { stdout, stderr } = await runFile(
    resolve(process.env.SystemRoot, "System32", "netstat.exe"),
    source.args,
    { windowsHide: true, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
  );
  verify(stderr.length === 0, "NETSTAT_DIAGNOSTIC_OUTPUT");
  const owned = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    if (parts[0] !== "TCP") continue; // UDP is outside the TCP collector.
    if (Number(parts.at(-1)) !== process.pid) continue;
    verify(parts.length === 5, "OWNED_TCP_ROW_INVALID");
    const local = endpoint(parts[1]);
    const remote = endpoint(parts[2]);
    verify(
      ["127.0.0.1", "::1"].includes(local.address) &&
        ["0.0.0.0", "::", "127.0.0.1", "::1"].includes(remote.address),
      "CANARY_NON_LOOPBACK_ROW",
    );
    owned.push({ local, remote, state: parts[3] });
  }
  const families = canaries.map((canary) => {
    const rows = owned.filter(
      (row) => row.local.address === canary.host && row.local.port === canary.port,
    );
    return {
      family: canary.host === "::1" ? "IPv6" : "IPv4",
      listenerCount: rows.filter((row) => row.state === "LISTENING").length,
      establishedAcceptedCount: rows.filter(
        (row) => row.state === "ESTABLISHED" && row.remote.address === canary.host,
      ).length,
    };
  });
  return {
    source: source.phase === "phase1g" ? "PHASE1G" : "PHASE1H",
    sourceSha256: createHash("sha256").update(source.bytes).digest("hex"),
    arguments: source.args,
    sampleMs: Date.now() - sampleStart,
    families,
    bothFamiliesObserved: families.every(
      (row) => row.listenerCount === 1 && row.establishedAcceptedCount === 1,
    ),
  };
}

try {
  verify(process.platform === "win32", "WINDOWS_REQUIRED");
  const paths = process.argv.slice(2);
  verify(paths.length === 0 || paths.length === 2, "ZERO_OR_TWO_COLLECTOR_SOURCES_REQUIRED");
  // Two explicit source paths are only for regression RED proof against old collectors.
  const sourcePaths = paths.length === 2 ? paths.map((path) => resolve(path)) : [
    resolve(repositoryRoot, "scripts", "electron-phase1g-smoke.mjs"),
    resolve(repositoryRoot, "scripts", "electron-phase1h-smoke.mjs"),
  ];
  sources.push(await readCollector(sourcePaths[0], "phase1g"));
  sources.push(await readCollector(sourcePaths[1], "phase1h"));
  const canaries = [await fixture("127.0.0.1"), await fixture("::1")];
  for (const source of sources) observations.push(await collect(source, canaries));
  verify(observations.every((row) => row.bothFamiliesObserved), "TCP_FAMILY_COVERAGE_MISSING");
} catch (error) {
  failureCode = error?.safeCode ?? "CANARY_OPERATION_FAILED";
} finally {
  for (const socket of sockets) socket.destroy();
  try {
    await Promise.all(servers.map((server) => bounded(
      new Promise((done) => {
        if (server.listening) server.close(() => done());
        else done();
      }),
      "CANARY_CLEANUP_TIMEOUT",
    )));
    socketsCleaned = sockets.every((socket) => socket.destroyed) &&
      servers.every((server) => !server.listening);
    verify(socketsCleaned, "CANARY_CLEANUP_FAILED");
  } catch (error) {
    cleanupCode = error?.safeCode ?? "CANARY_CLEANUP_FAILED";
  }
  try {
    for (const source of sources) {
      verify((await readFile(source.path)).equals(source.bytes), "COLLECTOR_SOURCE_CHANGED");
    }
    sourceUnchanged = sources.length === 2;
  } catch (error) {
    failureCode ??= error?.safeCode ?? "COLLECTOR_SOURCE_READ_FAILED";
  }
}

const pass = failureCode === null && cleanupCode === null && socketsCleaned && sourceUnchanged;
process.stdout.write(`${JSON.stringify({
  purpose: "ACTUAL_COLLECTOR_COMMAND_IPV4_IPV6_LOOPBACK_LISTEN_AND_ESTABLISHED_CANARY",
  acceptance: false,
  runtimeNetworkGate: false,
  status: pass ? "PASS" : "FAIL",
  code: failureCode,
  cleanupCode,
  startedUtc,
  finishedUtc: new Date().toISOString(),
  externalConnectionsInvoked: 0,
  endpointsLogged: false,
  sourceUnchanged,
  socketsCleaned,
  observations,
})}\n`);
if (!pass) process.exitCode = 1;
