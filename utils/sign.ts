import { signPath } from "../src/auth";

async function main() {
  const [, , pathname, expArg, secret] = process.argv;

  if (!pathname || !expArg || !secret) {
    console.error("Usage: pnpm sign <pathname> <exp-unix-seconds> <secret>");
    process.exit(1);
  }

  const sig = await signPath(pathname, expArg, secret);
  process.stdout.write(`${sig}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
