const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");

test("kernel validation rejects the home, unrelated folders, existing notes and workspace symlinks", async () => {
    const {validateKernelValidationRoot} = await import("./validationIsolation.mjs");
    const root = mkdtempSync(join(tmpdir(), "siyuan-isolation-test-"));
    try {
        assert.throws(() => validateKernelValidationRoot("/Users"));
        assert.throws(() => validateKernelValidationRoot("/Applications"));
        assert.equal(validateKernelValidationRoot(root), require("node:fs").realpathSync(root));
        mkdirSync(join(root, "workspace"));
        assert.throws(() => validateKernelValidationRoot(root), /non-validation/);
        writeFileSync(join(root, "workspace/.skynote-validation-workspace"), "owned");
        assert.ok(validateKernelValidationRoot(root));
        rmSync(join(root, "workspace"), {recursive: true});
        const target = join(root, "other");
        mkdirSync(target);
        writeFileSync(join(target, ".skynote-validation-workspace"), "owned");
        symlinkSync(target, join(root, "workspace"));
        assert.throws(() => validateKernelValidationRoot(root), /symlink/);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("the sandbox quotes complete paths and denies both reads and writes", async () => {
    const {createKernelSandboxProfile} = await import("./validationIsolation.mjs");
    const profile = createKernelSandboxProfile(['/tmp/home "quoted"/notes', "/tmp/other"]);
    assert.ok(profile.includes("(deny file-read* file-write*"));
    assert.ok(profile.includes(JSON.stringify('/tmp/home "quoted"/notes')));
    assert.ok(profile.includes('(subpath "/tmp/other")'));
});
