import {execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(app, "..");
const require = createRequire(join(app, "package.json"));
const webpack = require("webpack");
const builder = require("electron-builder");
const args = process.argv.slice(2);
const argument = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = args.includes("--baseline");
const output = resolve(argument("output") || join(repo, "..", "..", "build", baseline ? "baseline" : "skynote"));
const baseResources = resolve(argument("base-resources") || "/Applications/SiYuan.app/Contents/Resources");
const outputRelative = relative(repo, output);
if (!outputRelative.startsWith("..") && !isAbsolute(outputRelative)) {
    throw new Error("Build output must be outside the upstream checkout");
}
if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("This local packaging script requires Apple silicon macOS");
}
const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const installed = JSON.parse(readFileSync(join(baseResources, "app", "package.json"), "utf8"));
const profileName = installed.localProfileName || installed.name || pkg.name;
const appId = argument("app-id") || "local.skynote.desktop";
if (installed.version !== pkg.version) {
    throw new Error(`Kernel resources version ${installed.version} differs from source ${pkg.version}`);
}
const kernelBinary = join(baseResources, "kernel", "SiYuan-Kernel");
const kernelInfo = execFileSync("go", ["version", "-m", kernelBinary], {encoding: "utf8"});
let kernelCommit = kernelInfo.match(/vcs\.revision=([0-9a-f]{40})/)?.[1];
const kernelManifestPath = argument("kernel-build-manifest");
if (kernelManifestPath) {
    const kernelManifest = JSON.parse(readFileSync(resolve(kernelManifestPath), "utf8"));
    const kernelHash = createHash("sha256").update(readFileSync(kernelBinary)).digest("hex");
    if (kernelManifest.kernelSHA256 !== kernelHash || kernelManifest.sourceVersion !== pkg.version ||
        kernelManifest.sourceCommit !== execFileSync("git", ["rev-parse", "HEAD"], {cwd: repo, encoding: "utf8"}).trim() ||
        kernelManifest.kernelTree !== execFileSync("git", ["rev-parse", "HEAD:kernel"], {cwd: repo, encoding: "utf8"}).trim()) {
        throw new Error("Local kernel build manifest does not match the binary and source checkout");
    }
    kernelCommit = kernelCommit || kernelManifest.sourceCommit;
}
if (!kernelCommit) {
    throw new Error("Kernel binary does not include a verifiable source revision");
}
try {
    execFileSync("git", ["cat-file", "-e", kernelCommit], {cwd: repo, stdio: "pipe"});
} catch {
    execFileSync("git", ["fetch", "--depth=1", "origin", kernelCommit], {cwd: repo, stdio: "pipe"});
}
const kernelTree = execFileSync("git", ["rev-parse", `${kernelCommit}:kernel`], {cwd: repo, encoding: "utf8"}).trim();
const sourceKernelTree = execFileSync("git", ["rev-parse", "HEAD:kernel"], {cwd: repo, encoding: "utf8"}).trim();
if (kernelTree !== sourceKernelTree || execFileSync("git", ["diff", "HEAD", "--", "kernel"], {cwd: repo, encoding: "utf8"})) {
    throw new Error("Installed kernel source differs from the working checkout; do not mix incompatible kernel and UI builds");
}
mkdirSync(output, {recursive: true});
let sourceApp = app;
if (baseline) {
    // 原版快照单独展开，共用依赖目录，构建不改变当前源码和开发产物。
    const snapshot = join(output, "source");
    mkdirSync(snapshot, {recursive: true});
    const archive = execFileSync("git", ["archive", "HEAD", "app/src", "app/stage", "app/appearance", "app/guide",
        "app/package.json", "app/tsconfig.json", "app/webpack.config.js", "app/webpack.desktop.js",
        "app/webpack.mobile.js", "app/webpack.export.js"], {cwd: repo, maxBuffer: 256 * 1024 * 1024});
    execFileSync("tar", ["-xf", "-", "-C", snapshot], {input: archive});
    sourceApp = join(snapshot, "app");
    if (!existsSync(join(sourceApp, "node_modules"))) {
        symlinkSync(join(app, "node_modules"), join(sourceApp, "node_modules"), "dir");
    }
}
const resources = join(output, "resources");
if (existsSync(resources)) {
    const previousManifest = join(output, "build-manifest.json");
    if (!existsSync(previousManifest) || JSON.parse(readFileSync(previousManifest, "utf8")).baseline !== baseline) {
        throw new Error("Refusing to replace resources without a matching build manifest");
    }
    // 仅清理脚本自己的资源输出，防止旧分包和验收脚本进入新的应用产物。
    rmSync(resources, {recursive: true, force: true});
}
mkdirSync(resources, {recursive: true});
for (const folder of ["stage", "appearance", "guide"]) {
    cpSync(join(sourceApp, folder), join(resources, folder), {recursive: true});
}
for (const folder of ["kernel", "pandoc", "pandoc-resources", "changelogs"]) {
    cpSync(join(baseResources, folder), join(resources, folder), {recursive: true});
}
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    cpSync(join(repo, file), join(resources, file));
}

for (const [name, configFile] of [["app", "webpack.config.js"], ["desktop", "webpack.desktop.js"],
    ["mobile", "webpack.mobile.js"], ["export", "webpack.export.js"]]) {
    const factory = require(join(sourceApp, configFile));
    const config = factory({}, {mode: "production"});
    config.context = sourceApp;
    config.watch = false;
    config.output.path = join(resources, "stage", "build", name);
    // 独立输出目录无需清理插件，避免其绝对路径清理源码中的开发构建。
    config.plugins = config.plugins.filter(plugin => plugin.constructor.name !== "CleanWebpackPlugin");
    console.log(`Building ${baseline ? "baseline" : "SiYuan"} ${name} frontend`);
    const compiler = webpack(config);
    const stats = await new Promise((resolveStats, reject) => compiler.run((error, result) => error ? reject(error) : resolveStats(result)));
    await new Promise((resolveClose, reject) => compiler.close(error => error ? reject(error) : resolveClose()));
    const report = stats.toJson({all: false, errors: true, warnings: true, timings: true, assets: true});
    writeFileSync(join(output, `webpack-${name}.json`), JSON.stringify(report, null, 2));
    if (stats.hasErrors()) {
        throw new Error(report.errors.map(error => error.message).join("\n"));
    }
    console.log(`Built ${name}: ${report.time}ms, ${report.assets.length} assets, ${report.warnings.length} warnings`);
}

const manifest = {
    sourceVersion: pkg.version,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {cwd: repo, encoding: "utf8"}).trim(),
    baseline,
    electronVersion: pkg.devDependencies.electron,
    kernelSource: baseResources,
    kernelCommit,
    kernelTree,
    kernelSHA256: createHash("sha256").update(readFileSync(kernelBinary)).digest("hex"),
    architecture: process.arch,
    profileName,
    appId,
    builtAt: new Date().toISOString(),
};
writeFileSync(join(output, "build-manifest.json"), JSON.stringify(manifest, null, 2));
if (!baseline) {
    const electronDist = join(dirname(require.resolve("electron/package.json")), "dist");
    const packagingProject = join(output, "packaging");
    mkdirSync(packagingProject, {recursive: true});
    writeFileSync(join(packagingProject, "package.json"), JSON.stringify({
        name: "siyuan-local-packager", version: pkg.version, private: true, packageManager: pkg.packageManager,
    }, null, 2));
    console.log("Packaging SiYuan for Apple silicon macOS");
    await builder.build({
        projectDir: packagingProject,
        targets: builder.Platform.MAC.createTarget("dir", builder.Arch.arm64),
        publish: "never",
        config: {
            extends: null,
            productName: "SiYuan",
            appId,
            asar: false,
            npmRebuild: false,
            electronDist,
            electronVersion: pkg.devDependencies.electron,
            extraMetadata: {name: "SiYuan", main: "electron/main.js", localProfileName: profileName},
            directories: {app, output: join(output, "macos")},
            files: ["electron/**/*", "!**/*.test.js"],
            extraResources: [
                ...["stage", "appearance", "guide", "kernel", "pandoc", "pandoc-resources", "changelogs"].map(folder => ({
                    from: join(resources, folder), to: folder,
                })),
                ...["LICENSE", "THIRD_PARTY_NOTICES.md"].map(file => ({from: join(resources, file), to: file})),
            ],
            mac: {
                identity: "-",
                hardenedRuntime: false,
                notarize: false,
                icon: join(app, "src/assets/icon.icns"),
                minimumSystemVersion: "12.0.0",
                protocols: [{name: "SiYuan", schemes: ["siyuan"]}],
            },
        },
    });
    console.log(`macOS app: ${join(output, "macos", "mac-arm64", "SiYuan.app")}`);
}
