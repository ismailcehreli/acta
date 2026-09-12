// Verification commands must run against the target Node.js runtime.
// The production image uses Node 22, and engines requires Node >= 22.

const requiredMajor = 22;
const [major] = process.versions.node.split(".").map(Number);

if (major < requiredMajor) {
  console.error(
    [
      "",
      `This project requires Node ${requiredMajor}; currently running Node ${process.versions.node}.`,
      `Node 20 end-of-life has passed and the production image uses Node ${requiredMajor}.`,
      "All verification must run against the target Node.js runtime.",
      "",
      "To switch:  nvm install 22 && nvm use",
      "(Specified in .nvmrc)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
