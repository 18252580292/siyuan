import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, test} from "node:test";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as scheduler from "./request";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const fakeWindow = {
    setTimeout,
    clearTimeout,
    siyuan: {languages: {total: "Total", emptyContent: "Empty"}},
};
before(() => Object.defineProperty(globalThis, "window", {configurable: true, value: fakeWindow}));
after(() => {
    if (previousWindow) {
        Object.defineProperty(globalThis, "window", previousWindow);
    } else {
        Reflect.deleteProperty(globalThis, "window");
    }
});

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 10));
const options: ISearchAssetOption = {
    method: 0, sort: 0, keys: [], col: "", row: "", layout: 0, k: "",
    types: {".txt": true, ".md": true, ".docx": true, ".xlsx": true, ".pptx": true},
};

const createPanel = (query: string) => {
    const node = () => {
        const classes = new Set(["fn__none"]);
        return {
            isConnected: true,
            value: query,
            innerHTML: "",
            replacements: 0,
            style: {} as Record<string, string>,
            classList: {
                add: (name: string) => classes.add(name),
                remove: (name: string) => classes.delete(name),
                contains: (name: string) => classes.has(name),
            },
            setAttribute: () => {},
            removeAttribute: () => {},
            replaceChildren() {
                this.replacements++;
            },
        };
    };
    const nodes = new Map<string, ReturnType<typeof node>>();
    ["#searchAssetInput", "#searchAssetList", "#searchAssetResult", "#searchAssetPreview", ".search__drag",
        '[data-type="assetPrevious"]', '[data-type="assetNext"]'].forEach(selector => nodes.set(selector, node()));
    const loading = node();
    const element = {
        isConnected: true,
        classList: {remove() {}},
        parentElement: {querySelector: () => loading},
        querySelector: (selector: string) => nodes.get(selector),
    } as unknown as Element;
    return {element, nodes, loading};
};

const createSearch = () => {
    const requests: {
        url: string;
        data: Record<string, unknown>;
        signal: AbortSignal;
        finish: (response: object) => void;
    }[] = [];
    const exports = {} as typeof import("./assets");
    const source = transpileModule(readFileSync(join(__dirname, "assets.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    new Function("require", "exports", "window", source)((name: string) => {
        if (name === "./request") {
            return scheduler;
        }
        if (name === "../constants") {
            return {Constants: {TIMEOUT_INPUT: 0}};
        }
        if (name === "../util/fetch") {
            return {
                fetchPost: (url: string, data: Record<string, unknown>, callback: (response: object) => void,
                            _headers: unknown, _failure: unknown, signal: AbortSignal) => new Promise<void>(resolve => {
                    requests.push({url, data, signal, finish: response => {
                        callback(response);
                        resolve();
                    }});
                }),
            };
        }
        return {};
    }, exports, fakeWindow);
    return {exports, requests};
};

const emptyResponse = (matchedAssetCount: number) => ({
    data: {assetContents: [] as object[], pageCount: 1, matchedAssetCount},
});

test("independent asset search panels do not cancel each other's debounce", async () => {
    const search = createSearch();
    const first = createPanel("first");
    const second = createPanel("second");
    search.exports.assetInputEvent(first.element, options);
    search.exports.assetInputEvent(second.element, options);
    await flush();
    assert.deepEqual(search.requests.map(request => request.data.query), ["first", "second"]);
    search.requests.forEach(request => request.finish(emptyResponse(0)));
    await flush();
});

test("stale results cannot overwrite the newest asset query", async () => {
    const search = createSearch();
    const panel = createPanel("old");
    search.exports.assetInputEvent(panel.element, options);
    await flush();
    panel.nodes.get("#searchAssetInput").value = "new";
    search.exports.assetInputEvent(panel.element, options);
    await flush();
    assert.equal(search.requests[0].signal.aborted, true);
    search.requests[0].finish(emptyResponse(999));
    assert.equal(panel.nodes.get("#searchAssetResult").innerHTML, "");
    await flush();
    assert.equal(search.requests[1].data.query, "new");
    search.requests[1].finish(emptyResponse(2));
    await flush();
    assert.ok(panel.nodes.get("#searchAssetResult").innerHTML.includes("Total 2"));
    assert.ok(!panel.nodes.get("#searchAssetResult").innerHTML.includes("999"));
});

test("typing bursts send only the final asset search", async () => {
    const search = createSearch();
    const panel = createPanel("");
    for (let index = 0; index < 100; index++) {
        panel.nodes.get("#searchAssetInput").value = `query-${index}`;
        search.exports.assetInputEvent(panel.element, options);
    }
    await flush();
    assert.equal(search.requests.length, 1);
    assert.equal(search.requests[0].data.query, "query-99");
    search.requests[0].finish(emptyResponse(0));
    await flush();
});

test("a newer preview selection prevents the old response from touching the preview", async () => {
    const search = createSearch();
    const preview = createPanel("").nodes.get("#searchAssetPreview");
    search.exports.renderPreview(preview as unknown as Element, "old-id", "old", 0);
    await flush();
    search.exports.renderPreview(preview as unknown as Element, "new-id", "new", 0);
    await flush();
    assert.equal(search.requests[0].signal.aborted, true);
    search.requests[0].finish({data: {assetContent: null}});
    assert.equal(preview.replacements, 0);
    await flush();
    search.requests[1].finish({data: {assetContent: null}});
    await flush();
    assert.equal(preview.replacements, 1);
});

test("closing a panel aborts its active request and prevents further rendering", async () => {
    const search = createSearch();
    const panel = createPanel("query");
    search.exports.assetInputEvent(panel.element, options);
    await flush();
    assert.equal(panel.loading.classList.contains("fn__none"), false);
    search.exports.cancelAssetSearch(panel.element);
    assert.equal(search.requests[0].signal.aborted, true);
    assert.equal(panel.loading.classList.contains("fn__none"), true);
    search.requests[0].finish(emptyResponse(100));
    await flush();
    assert.equal(panel.nodes.get("#searchAssetResult").innerHTML, "");
});

const reopenMobileAssets = (search: ReturnType<typeof createSearch>, panel: ReturnType<typeof createPanel>) => {
    const file = createSourceFile("search.ts", readFileSync(join(__dirname, "../mobile/menu/search.ts"), "utf8"), ScriptTarget.Latest, true);
    const statement = file.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(file) === "goAsset"));
    const compiled = transpileModule(statement.getText(file) + "\nexport {goAsset};", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exports = {} as {goAsset: () => void};
    const resume = (search.exports as unknown as {resumeAssetSearch: (element: Element) => boolean}).resumeAssetSearch;
    new Function("exports", "document", "window", "resumeAssetSearch", "assetInputEvent", compiled)(exports,
        {querySelector: () => panel.element}, fakeWindow, resume, search.exports.assetInputEvent);
    exports.goAsset();
};

test("reopening an interrupted asset search resumes the same page and current query", async () => {
    const search = createSearch();
    const panel = createPanel("latest query");
    panel.nodes.get("#searchAssetList").innerHTML = "previous query results";
    search.exports.assetInputEvent(panel.element, options, 3);
    await flush();
    search.exports.cancelAssetSearch(panel.element);
    reopenMobileAssets(search, panel);
    await flush();
    assert.equal(search.requests.length, 2);
    assert.equal(search.requests[1].data.page, 3);
    assert.equal(search.requests[1].data.query, "latest query");
    search.requests[0].finish(emptyResponse(999));
    search.requests[1].finish(emptyResponse(3));
    await flush();
    assert.ok(!panel.nodes.get("#searchAssetResult").innerHTML.includes("999"));
    search.exports.cancelAssetSearch(panel.element);
    reopenMobileAssets(search, panel);
    await flush();
    assert.equal(search.requests.length, 2, "completed results should be retained without a new query");
});

test("returning to completed results resumes only an interrupted asset preview", async () => {
    const search = createSearch();
    const panel = createPanel("same query");
    panel.nodes.get("#searchAssetList").innerHTML = "completed results";
    const preview = panel.nodes.get("#searchAssetPreview");
    search.exports.renderPreview(preview as unknown as Element, "selected-id", "same query", 3);
    await flush();
    search.exports.cancelAssetSearch(panel.element);
    reopenMobileAssets(search, panel);
    await flush();
    assert.equal(search.requests.length, 2);
    assert.equal(search.requests[1].url, "/api/search/getAssetContent");
    assert.deepEqual(search.requests[1].data, {id: "selected-id", query: "same query", queryMethod: 3});
    search.requests[0].finish({data: {assetContent: null}});
    search.requests[1].finish({data: {assetContent: null}});
    await flush();
    assert.equal(preview.replacements, 1);
    assert.equal(panel.nodes.get("#searchAssetList").innerHTML, "completed results");
});
