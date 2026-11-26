const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const here = __dirname;
const projectRoot = path.resolve(here, "..");

// These scripts inspect the deploy inputs the way Render does (build context, Dockerfile COPYs,
// download routes). A failure here is the same failure Render reports seconds into the build.
for (const script of ["deploy-paths-check.js", "docker-image-check.js"]) {
  test(`deploy-gate/${script} passes`, () => {
    const output = execFileSync(process.execPath, [path.join(here, script)], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, HOST: "127.0.0.1" },
    });
    assert.match(output, /PASS/, output);
  });
}
