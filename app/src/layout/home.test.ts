import test from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as homeData from "./homeData";
import {escapeAttr, escapeHtml} from "../util/escape";

const id = "20261012120000-abcdefg";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {
    let resolve: (value: {code: number, data: unknown}) => void;
    const promise = new Promise<{code: number, data: unknown}>(done => resolve = done);
    return {promise, resolve};
};
const panel = () => {
    const classes = new Set<string>();
    const status = {textContent: "", classList: {remove: (value: string) => classes.delete(value),
        toggle: (value: string, on: boolean) => on ? classes.add(value) : classes.delete(value)}};
    const container = {innerHTML: "", replaceChildren() { this.innerHTML = ""; }};
    const refresh = {addEventListener() {}};
    return {isConnected: true, contains: () => false, addEventListener() {}, status, container,
        querySelector: (selector: string) => selector === ".layout__home-status" ? status : selector === "[data-home-refresh]" ? refresh : container};
};
const load = (responses: ReturnType<typeof deferred>[], readonly = false) => {
    const calls: {url: string, data: object}[] = [];
    const exports = {} as {initHomeRecentDocs: (app: object, target: ReturnType<typeof panel>) => void,
        invalidateHomeRecentDocs: (notebookID?: string, closed?: boolean) => void};
    const panels: ReturnType<typeof panel>[] = [];
    const source = ts.transpileModule(readFileSync(join(__dirname, "home.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {exports, Intl, CSS: {escape: (value: string) => value},
        document: {activeElement: null, querySelectorAll: () => panels.map(target => target.container)},
        window: {siyuan: {config: {readonly, appearance: {lang: "zh-CN"}}, languages: {loading: "Loading", empty: "Empty", refresh: "Refresh", recentViewed: "Recent", updatedTime: "Updated"}}},
        require: (name: string) => {
            if (name.endsWith("/homeData")) { return homeData; }
            if (name.endsWith("/escape")) { return {escapeAttr, escapeHtml}; }
            if (name.endsWith("/fileTreeIcon")) { return {getFileTreeIconHTML: () => ""}; }
            if (name.endsWith("/fetch")) {
                return {fetchSyncPost: (url: string, data: object) => {
                    calls.push({url, data});
                    return responses.shift().promise;
                }};
            }
            return {};
        },
    });
    return {init: (app: object, target: ReturnType<typeof panel>) => { panels.push(target); exports.initHomeRecentDocs(app, target); },
        invalidate: exports.invalidateHomeRecentDocs, calls};
};

test("detached home panels discard responses and never request previews", async () => {
    const recent = deferred();
    const home = load([recent]);
    const target = panel();
    home.init({}, target);
    await tick();
    target.isConnected = false;
    recent.resolve({code: 0, data: [{rootID: id, title: "private"}]});
    await tick();
    assert.equal(home.calls.length, 1);
    assert.equal(target.container.innerHTML, "");
});

test("read-only home panels render accessible recent documents without additional SQL", async () => {
    const recent = deferred();
    const home = load([recent], true);
    const target = panel();
    home.init({}, target);
    recent.resolve({code: 0, data: [{rootID: id, title: "<script>"}]});
    await tick();
    assert.equal(home.calls.length, 1);
    assert.match(target.container.innerHTML, /&lt;script>/);
    assert.doesNotMatch(target.container.innerHTML, /<script>/);
});

test("recent card dates interpret the kernel timestamp as seconds in read-only mode", async () => {
    const recent = deferred();
    const home = load([recent], true);
    const target = panel();
    const time = Date.parse("2026-10-15T12:00:00Z");
    home.init({}, target);
    recent.resolve({code: 0, data: [{rootID: id, title: "Note", viewedAt: time / 1000}]});
    await tick();
    assert.ok(target.container.innerHTML.includes(new Intl.DateTimeFormat("zh-CN", {month: "short", day: "numeric"}).format(new Date(time))));
    assert.equal(home.calls.length, 1);
});

test("concurrent home panels share both requests and escape content previews", async () => {
    const recent = deferred();
    const metadata = deferred();
    const home = load([recent, metadata]);
    const first = panel();
    const second = panel();
    home.init({}, first);
    home.init({}, second);
    recent.resolve({code: 0, data: [{rootID: id, title: "Note"}]});
    await tick();
    assert.equal(home.calls.length, 2);
    assert.equal((home.calls[1].data as {mode: string}).mode, "readonly");
    metadata.resolve({code: 0, data: [{id, content: '<img src=x onerror="alert(1)">', updated: "20261012120000"}]});
    await tick();
    assert.equal(first.container.innerHTML, second.container.innerHTML);
    assert.match(first.container.innerHTML, /&lt;img/);
    assert.doesNotMatch(first.container.innerHTML, /<img src=x/);
});

test("closing a notebook clears visible previews immediately and rejects its pending metadata", async () => {
    const recent = deferred();
    const metadata = deferred();
    const refreshed = deferred();
    const home = load([recent, metadata, refreshed]);
    const target = panel();
    home.init({}, target);
    recent.resolve({code: 0, data: [{rootID: id, title: "private title"}]});
    await tick();
    assert.match(target.container.innerHTML, /private title/);
    home.invalidate();
    assert.equal(target.container.innerHTML, "");
    await tick();
    metadata.resolve({code: 0, data: [{id, content: "private stale preview"}]});
    refreshed.resolve({code: 0, data: []});
    await tick();
    assert.equal(target.container.innerHTML, "");
    assert.equal(home.calls.length, 3);
});

test("a notebook close never reuses an earlier pending recent-documents request", async () => {
    const recent = deferred();
    const refreshed = deferred();
    const home = load([recent, refreshed]);
    const target = panel();
    home.init({}, target);
    await tick();
    home.invalidate();
    await tick();
    assert.equal(home.calls.length, 2);
    recent.resolve({code: 0, data: [{rootID: id, title: "closed notebook"}]});
    refreshed.resolve({code: 0, data: []});
    await tick();
    assert.equal(target.container.innerHTML, "");
    assert.equal(home.calls.length, 2);
});

test("home previews exclude a closed notebook and restore it after reopening", async () => {
    const responses = Array.from({length: 6}, deferred);
    const home = load(responses.slice());
    const target = panel();
    home.init({}, target);
    responses[0].resolve({code: 0, data: [{rootID: id, title: "Note"}]});
    await tick();
    responses[1].resolve({code: 0, data: []});
    await tick();
    home.invalidate(id);
    responses[2].resolve({code: 0, data: [{rootID: id, title: "Note"}]});
    await tick();
    assert.match((home.calls[3].data as {stmt: string}).stmt, new RegExp(`d.box NOT IN \\('${id}'\\)`));
    responses[3].resolve({code: 0, data: []});
    await tick();
    home.invalidate(id, false);
    responses[4].resolve({code: 0, data: [{rootID: id, title: "Note"}]});
    await tick();
    assert.doesNotMatch((home.calls[5].data as {stmt: string}).stmt, /d.box NOT IN/);
    responses[5].resolve({code: 0, data: [{id, content: "Visible after reopening"}]});
    await tick();
    assert.match(target.container.innerHTML, /Visible after reopening/);
});
