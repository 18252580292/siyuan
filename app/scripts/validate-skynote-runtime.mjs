import {spawn} from "node:child_process";
import {prepareKernelValidationIsolation} from "./validationIsolation.mjs";
import {randomBytes} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = resolve(app, "..", "..", "..");
const args = process.argv.slice(2);
const argument = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const isolation = prepareKernelValidationIsolation(resolve(argument("root") || join(project, "validation", "runtime")));
const root = isolation.root;
const resources = resolve(argument("resources") || join(project, "build", "siyuan", "resources"));
const workspace = join(root, "workspace");
const marker = join(workspace, ".skynote-validation-workspace");
const port = Number(argument("port") || 19087);
if (existsSync(workspace) && !existsSync(marker)) {
    throw new Error("Refusing to use an existing non-validation workspace");
}
mkdirSync(workspace, {recursive: true});
writeFileSync(marker, "SkyNote generated validation data\n");
const authFile = join(root, "runtime-auth.json");
const token = existsSync(authFile) ? JSON.parse(readFileSync(authFile, "utf8")).token : randomBytes(32).toString("hex");
writeFileSync(authFile, JSON.stringify({token, port}), {mode: 0o600});
const base = `http://127.0.0.1:${port}`;
const api = async (path, data = {}) => {
    const apiToken = JSON.parse(readFileSync(join(workspace, "conf", "conf.json"), "utf8")).api.token;
    const response = await fetch(base + path, {
        method: "POST", headers: {Authorization: `Token ${apiToken}`, "Content-Type": "application/json"},
        body: JSON.stringify(data), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (result.code !== 0) {
        throw new Error(`${path}: ${result.msg || result.code}`);
    }
    return result.data;
};
// 内核仅访问独立工作空间和用户目录，隔离失效时由文件访问限制中止。
const kernel = spawn(isolation.command, [...isolation.args, join(resources, "kernel", "SiYuan-Kernel"), "serve", "--workspace", workspace,
    "--wd", resources, "--port", String(port), "--lang", "zh-CN"], {
    env: {...isolation.env, SIYUAN_ACCESS_AUTH_CODE: token}, stdio: ["ignore", "pipe", "pipe"],
});
let exited = false;
let bootOutput = "";
kernel.on("exit", () => exited = true);
kernel.stdout.on("data", chunk => bootOutput = (bootOutput + chunk).slice(-4000));
kernel.stderr.on("data", chunk => bootOutput = (bootOutput + chunk).slice(-4000));
let stopping;
const stop = () => stopping ||= (async () => {
    if (!exited) {
        await api("/api/system/exit", {force: false, setCurrentWorkspace: false}).catch(() => {});
        for (let attempt = 0; attempt < 20 && !exited; attempt++) {
            await new Promise(resolveWait => setTimeout(resolveWait, 250));
        }
        if (!exited) {
            kernel.kill("SIGTERM");
            for (let attempt = 0; attempt < 20 && !exited; attempt++) {
                await new Promise(resolveWait => setTimeout(resolveWait, 250));
            }
            if (!exited) throw new Error("Owned validation kernel did not stop");
        }
    }
    isolation.assertUnchanged();
})();

process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });

try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
        if (exited) {
            throw new Error(`Validation kernel exited during boot: ${bootOutput.replaceAll(token, "[test-token]")}`);
        }
        try {
            await api("/api/system/getConf");
            ready = true;
            break;
        } catch {
            await new Promise(resolveWait => setTimeout(resolveWait, 250));
        }
    }
    if (!ready) {
        kernel.kill("SIGTERM");
        throw new Error(`Validation kernel did not become ready: ${bootOutput.replaceAll(token, "[test-token]")}`);
    }
    writeFileSync(join(root, "runtime-process.json"), JSON.stringify({pid: kernel.pid, port, resources, workspace}, null, 2));
    console.log(`Validation kernel ready: pid ${kernel.pid}, port ${port}`);

    if (args.includes("--seed")) {
        const seedFile = join(root, "fixtures.json");
        if (existsSync(seedFile)) {
            throw new Error("Validation fixtures already exist; use --serve to reuse them");
        }
        try {
            const created = await api("/api/notebook/createNotebook", {name: "SkyNote 验收笔记"});
            const notebook = created.notebook.id;
            const documents = {};
            const create = async (name, markdown) => {
                const id = await api("/api/filetree/createDocWithMd", {notebook, path: `/${name}`, markdown});
                documents[name] = id;
                return id;
            };
            await create("欢迎使用 SkyNote", "# 写下今天的灵感\n\n这是用于验收的独立工作空间。\n\n## 我的计划\n\n- [ ] 整理想法\n- [x] 留下第一条笔记\n\n> 保留空间，让思考慢慢发生。\n\n| 项目 | 状态 |\n| --- | --- |\n| 笔记与编辑 | 验收中 |\n| 搜索与文件树 | 验收中 |\n\n行内公式 $E=mc^2$ 和 **重点内容**。\n\n```typescript\nconst note = {title: \"SkyNote\", saved: true};\nconsole.log(note);\n```\n");
            await create("长文档 · 一万个段落", Array.from({length: 10000}, (_, index) =>
                `${index % 100 === 0 ? "## " : ""}段落 ${index + 1}：性能验收标记 skynote-benchmark。记录阅读、写作和思考，检查滚动与输入时的响应。\n`
            ).join("\n"));
            await create("图表与公式", Array.from({length: 10}, (_, index) =>
                "## 图表 " + (index + 1) + "\n\n```mermaid\ngraph LR\nA[思考] --> B[记录]\nB --> C[整理]\n```\n\n```echarts\n" + JSON.stringify({xAxis: {type: "category", data: ["周一", "周二", "周三"]}, yAxis: {type: "value"}, series: [{data: [12, 20, 15], type: "line"}]}) + "\n```\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$\n"
            ).join("\n"));
            for (let index = 0; index < 80; index++) {
                await create(`资料 ${String(index + 1).padStart(3, "0")}`, `资料条目 ${index + 1}，用于文件树与搜索验收。\n\n关键字：skynote-benchmark。\n`);
            }
            for (let index = 0; index < 20; index++) {
                await create(`项目 ${String(index + 1).padStart(2, "0")}/项目记录`, `项目 ${index + 1} 的嵌套笔记。\n`);
            }
            await api("/api/system/setAppearanceMode", {mode: 0});
            writeFileSync(seedFile, JSON.stringify({notebook, documents, longDocumentParagraphs: 10000}, null, 2));
            console.log(`Created ${Object.keys(documents).length} test documents, including a 10000-paragraph document`);
        } finally {
            await stop();
        }
    } else if (!args.includes("--probe")) {
        console.log(`Frontend: ${base}/stage/build/desktop/`);
        await new Promise(resolveExit => kernel.once("exit", resolveExit));
    }
} finally {
    await stop();
}
