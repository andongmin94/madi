const EXPECTED_NODE = "v26.3.1";
const EXPECTED_PNPM = "11.9.0";

const packageManagerUserAgent =
  process.env.npm_config_user_agent?.trim() ?? "";
const pnpmVersion =
  /^pnpm\/([^\s]+)/.exec(packageManagerUserAgent)?.[1] ?? "";

if (process.version !== EXPECTED_NODE) {
  throw new Error(
    `Node ${EXPECTED_NODE} is required; current runtime is ${process.version}`,
  );
}
if (pnpmVersion !== EXPECTED_PNPM) {
  throw new Error(
    `pnpm ${EXPECTED_PNPM} is required; current package manager is ` +
      `${pnpmVersion || "unknown"}`,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      node: process.version,
      pnpm: pnpmVersion,
      exactToolchain: true,
    },
    null,
    2,
  )}\n`,
);
