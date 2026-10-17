import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const inside = (parent, child) => {
    const path = relative(parent, child);
    return path === "" || !path.startsWith("..") && !isAbsolute(path);
};
const canonical = path => {
    if (existsSync(path)) return realpathSync(path);
    const parent = dirname(path);
    return join(canonical(parent), relative(parent, path));
};

export const validateKernelValidationRoot = (root, home = homedir()) => {
    const target = canonical(resolve(root));
    const realHome = canonical(home);
    if (inside(target, realHome) || ![join(project, "validation"), canonical(tmpdir())].some(parent => inside(parent, target) && parent !== target)) {
        throw new Error("Validation root must be an owned child of project validation/ or the temporary directory");
    }
    const workspace = join(target, "workspace");
    if (existsSync(workspace) && (!existsSync(join(workspace, ".skynote-validation-workspace")) || realpathSync(workspace) !== workspace)) {
        throw new Error("Refusing a non-validation workspace or workspace symlink");
    }
    return target;
};

export const createKernelSandboxProfile = paths => "(version 1)(allow default)(deny file-read* file-write* " +
    paths.map(path => "(subpath " + JSON.stringify(resolve(path)) + ")").join(" ") + ")";

// 验收内核的系统账户主目录单独重定向，文件访问限制阻止隔离失效时写入真实配置。
export const prepareKernelValidationIsolation = root => {
    if (process.platform !== "darwin") {
        throw new Error("Native kernel validation requires macOS isolation or a separately isolated OS account");
    }
    root = validateKernelValidationRoot(root);
    const realHome = homedir();
    const recent = join(realHome, ".config/siyuan/workspace.json");
    const before = existsSync(recent) ? readFileSync(recent) : undefined;
    const workspaces = before ? JSON.parse(before.toString("utf8")) : [];
    assert.ok(Array.isArray(workspaces) && workspaces.every(path => typeof path === "string"));
    const home = join(root, "test-home");
    const isolation = join(root, "isolation");
    mkdirSync(join(home, ".config/siyuan"), {recursive: true});
    mkdirSync(isolation, {recursive: true});
    writeFileSync(join(home, ".config/siyuan/workspace.json"), JSON.stringify([join(root, "workspace")]));
    if (before) writeFileSync(join(isolation, "user-workspaces-before.json"), before, {mode: 0o600});
    const source = `#include <pwd.h>
#include <stdlib.h>
#include <sys/types.h>
static int qa_getpwuid_r(uid_t uid, struct passwd *entry, char *buffer, size_t length, struct passwd **result) {
    int status = getpwuid_r(uid, entry, buffer, length, result);
    const char *home = getenv("SIYUAN_QA_HOME");
    if (status == 0 && *result != NULL && home != NULL && home[0] != 0) entry->pw_dir = (char *) home;
    return status;
}
__attribute__((used)) static struct {const void *replacement; const void *original;}
qa_interpose __attribute__((section("__DATA,__interpose"))) = {(const void *) qa_getpwuid_r, (const void *) getpwuid_r};
`;
    const sourcePath = join(isolation, "qa-home.c");
    const library = join(isolation, "qa-home.dylib");
    if (!existsSync(library) || !existsSync(sourcePath) || readFileSync(sourcePath, "utf8") !== source) {
        writeFileSync(sourcePath, source);
        execFileSync("clang", ["-dynamiclib", "-arch", process.arch, sourcePath, "-o", library], {stdio: "pipe"});
    }
    const profile = join(isolation, "kernel.sb");
    writeFileSync(profile, createKernelSandboxProfile([
        join(realHome, ".config/siyuan"), join(realHome, "Library/Application Support/SiYuan"),
        join(realHome, "Library/Application Support/SiYuan-Electron"), join(realHome, "Library/Application Support/SkyNote-Electron"),
        ...workspaces.map(path => resolve(realHome, "..", path)),
    ]));
    return {
        root,
        command: "/usr/bin/sandbox-exec",
        args: ["-f", profile, "/usr/bin/env", "HOME=" + home, "SIYUAN_QA_HOME=" + home, "DYLD_INSERT_LIBRARIES=" + library],
        env: {...process.env, HOME: home},
        assertUnchanged() {
            if (before) assert.deepEqual(readFileSync(recent), before, "The real workspace list changed during validation");
            else assert.equal(existsSync(recent), false, "Validation created a real workspace list");
            writeFileSync(join(isolation, "proof.json"), JSON.stringify({realWorkspaceListUnchanged: true, systemAccountHomeRedirected: true,
                realUserPathsDenied: true, isolatedHome: home}, null, 2));
        },
    };
};
