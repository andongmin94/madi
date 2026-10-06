const EXPECTED_NODE = "v24.21.0";
const EXPECTED_NPM = "12.2.0";

const packageManagerUserAgent =
  process.env.npm_config_user_agent?.trim() ?? "";
const npmVersion =
  /^npm\/([^\s]+)/.exec(packageManagerUserAgent)?.[1] ?? "";

if (process.version !== EXPECTED_NODE) {
  throw new Error(
    `Node ${EXPECTED_NODE} is required; current runtime is ${process.version}`,
  );
}
if (npmVersion !== EXPECTED_NPM) {
  throw new Error(
    `npm ${EXPECTED_NPM} is required; current package manager is ` +
      `${npmVersion || "unknown"}`,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      node: process.version,
      npm: npmVersion,
      exactToolchain: true,
    },
    null,
    2,
  )}\n`,
);
