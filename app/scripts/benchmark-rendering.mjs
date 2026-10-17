import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import ts from "typescript";

const app = fileURLToPath(new URL("../", import.meta.url));
const sourceAt = (relative, baseline) => baseline
    ? execFileSync("git", ["show", `HEAD:app/${relative}`], {cwd: app, encoding: "utf8"})
    : readFileSync(resolve(app, relative), "utf8");
const load = (source, environment) => {
    const exports = {};
    const code = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    new Function("exports", ...Object.keys(environment), code)(exports, ...Object.values(environment));
    return exports;
};

const measureScripts = async (baseline) => {
    const scripts = [];
    const removed = new Set();
    const document = {
        getElementById: id => scripts.find(script => script.id === id && !removed.has(script)),
        createElement: () => {
            const script = {remove: () => removed.add(script)};
            return script;
        },
        head: {appendChild: script => scripts.push(script)},
    };
    const loader = load(sourceAt("src/protyle/util/addScript.ts", baseline), {
        document,
        require: () => ({isRemoteKernel: () => false}),
    });
    const tasks = Array.from({length: 1000}, () => loader.addScript("/highlight.js", "highlight"));
    const inserted = scripts.length;
    scripts.forEach(script => script.onload());
    await Promise.all(tasks);
    return inserted;
};

const measureViewport = (baseline, size, visibleIndex) => {
    let measurements = 0;
    const blocks = Array.from({length: size}, (_, index) => ({
        getAttribute: () => `block-${index}`,
        getBoundingClientRect: () => {
            measurements++;
            return {top: index * 40, bottom: index * 40 + 40};
        },
    }));
    const viewport = load(sourceAt("src/protyle/scroll/viewport.ts", baseline), {});
    const top = visibleIndex * 40 + 10;
    const result = baseline
        ? viewport.getVisibleRootBlockID(blocks.map(block => ({id: block.getAttribute(), ...block.getBoundingClientRect()})), top, top + 600)
        : viewport.getVisibleRootBlockIDFromElements(blocks, top, top + 600);
    if (result !== `block-${visibleIndex}`) {
        throw new Error("Viewport result changed");
    }
    return measurements;
};

const measureTreeRestore = async (baseline, branches) => {
    const restore = load(sourceAt("src/util/fileTreeRestore.ts", baseline), {});
    let active = 0;
    let peak = 0;
    let requests = 0;
    await restore.restoreFileTreePaths([{
        notebookId: "notebook",
        openPaths: Array.from({length: branches}, (_, index) => `/branch-${index}/leaf.sy`),
    }], async () => {
        requests++;
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 0));
        active--;
    });
    return {requests, peak};
};

const results = {
    kind: "Synthetic operation counts, not end-to-end application timings",
    baseline: execFileSync("git", ["rev-parse", "--short", "HEAD"], {cwd: app, encoding: "utf8"}).trim(),
    concurrentScriptRequests: {
        callers: 1000,
        before: await measureScripts(true),
        after: await measureScripts(false),
        metric: "script elements inserted",
    },
    viewport: [150, 10000].flatMap(size => [0, Math.floor(size / 2), size - 1].map(visibleIndex => ({
        loadedBlocks: size,
        firstVisibleIndex: visibleIndex,
        before: measureViewport(true, size, visibleIndex),
        after: measureViewport(false, size, visibleIndex),
        metric: "block geometry reads",
    }))),
    fileTreeRestoration: {
        expandedBranches: 1000,
        before: await measureTreeRestore(true, 1000),
        after: await measureTreeRestore(false, 1000),
        metric: "total requests and peak simultaneous requests",
    },
};
console.log(JSON.stringify(results, null, 2));
