import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {ModuleKind, transpileModule} from "typescript";
import * as viewport from "./viewport";

test("split editors keep independent scroll timers and measure only the visible prefix", () => {
    const timers = new Map<number, () => void>();
    let sequence = 0;
    const exports = {} as typeof import("./event");
    const source = transpileModule(readFileSync(join(__dirname, "event.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const fakeWindow = {
        setTimeout: (callback: () => void) => {
            timers.set(++sequence, callback);
            return sequence;
        },
        siyuan: {},
    };
    new Function("exports", "require", "window", "clearTimeout", "requestAnimationFrame", source)(exports,
        (name: string) => name === "./viewport" ? viewport : {
            Constants: {TIMEOUT_LOAD: 100}, isMobile: () => false, hideElements: () => {},
            isDocumentBoundaryLoaded: () => false,
        }, fakeWindow, (id: number) => timers.delete(id), () => 0);

    const createEditor = () => {
        let listener: () => void;
        let viewportReads = 0;
        let blockReads = 0;
        const indexes: string[] = [];
        const element = {
            isConnected: true, scrollTop: 10, scrollHeight: 1000, clientHeight: 300,
            addEventListener: (_type: string, callback: () => void) => listener = callback,
            setAttribute: () => {},
            getBoundingClientRect: () => {
                viewportReads++;
                return {top: 0, bottom: 300};
            },
        };
        const blocks = Array.from({length: 1000}, (_, index) => ({
            getAttribute: () => `block-${index}`,
            getBoundingClientRect: () => {
                blockReads++;
                return {top: index * 40, bottom: index * 40 + 40};
            },
        }));
        const protyle = {
            contentElement: element,
            element: {classList: {contains: () => false}},
            toolbar: {element: {classList: {contains: () => true}}},
            block: {showAll: false, blockCount: 1000},
            wysiwyg: {element: {getElementsByClassName: (): Element[] => [], children: blocks,
                getAttribute: (): string | null => null}},
            scroll: {element: {classList: {contains: () => false}}, lastScrollTop: -1,
                updateIndex: (_protyle: unknown, id: string) => indexes.push(id)},
        };
        exports.scrollEvent(protyle as unknown as IProtyle, element as unknown as HTMLElement);
        return {
            element, indexes, scroll: () => listener(), viewportReads: () => viewportReads, blockReads: () => blockReads,
        };
    };
    const first = createEditor();
    const second = createEditor();
    first.scroll();
    second.scroll();
    assert.equal(timers.size, 2);
    assert.equal(first.viewportReads(), 0);
    assert.equal(second.viewportReads(), 0);
    Array.from(timers.values()).forEach(callback => callback());
    assert.deepEqual(first.indexes, ["block-0"]);
    assert.deepEqual(second.indexes, ["block-0"]);
    assert.equal(first.blockReads(), 1);
    assert.equal(second.blockReads(), 1);

    timers.clear();
    first.scroll();
    first.element.isConnected = false;
    const previousReads = first.blockReads();
    Array.from(timers.values()).forEach(callback => callback());
    assert.equal(first.blockReads(), previousReads);
});

test("database scrolling reads the current viewport before applying row changes", () => {
    const calls: string[] = [];
    const frames: (() => void)[] = [];
    let listener: () => void;
    const av = {dataset: {render: "true"}, isConnected: true};
    const element = {
        isConnected: true, scrollTop: 10,
        addEventListener: (_type: string, callback: () => void) => listener = callback,
        setAttribute: () => {},
        getBoundingClientRect: () => {
            calls.push("viewport");
            return {top: 0, bottom: 300};
        },
    };
    const protyle = {
        contentElement: element,
        element: {classList: {contains: () => false}},
        toolbar: {element: {classList: {contains: () => true}}},
        block: {showAll: true},
        wysiwyg: {element: {getElementsByClassName: () => [av], getAttribute: (): string | null => null}},
    };
    const exports = {} as typeof import("./event");
    const source = transpileModule(readFileSync(join(__dirname, "event.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    new Function("exports", "require", "window", "requestAnimationFrame", source)(exports,
        () => ({
            isMobile: () => false, hideElements: () => {},
            stickyRow: () => calls.push("sticky"), trimAVRowsSync: () => calls.push("trim"),
        }), {siyuan: {}}, (callback: () => void) => frames.push(callback));
    exports.scrollEvent(protyle as unknown as IProtyle, element as unknown as HTMLElement);
    listener();
    assert.deepEqual(calls, []);
    frames.shift()();
    assert.deepEqual(calls, ["viewport", "sticky", "trim"]);
    calls.length = 0;
    listener();
    av.isConnected = false;
    frames.shift()();
    assert.deepEqual(calls, []);
});

test("closing an editor cancels its scroll timer, pending animation and event listener", () => {
    let listener: () => void;
    const timers = new Map<number, () => void>();
    const frames = new Map<number, () => void>();
    let removed = 0;
    const av = {dataset: {render: "true"}, isConnected: true};
    const element = {
        isConnected: true, scrollTop: 10, scrollHeight: 1000, clientHeight: 300,
        addEventListener: (_type: string, callback: () => void) => listener = callback,
        removeEventListener: (_type: string, callback: () => void) => { assert.equal(callback, listener); removed++; },
        setAttribute: () => {},
    };
    const protyle = {contentElement: element, element: {classList: {contains: () => false}},
        toolbar: {element: {classList: {contains: () => true}}}, block: {showAll: true},
        wysiwyg: {element: {getElementsByClassName: () => [av], getAttribute: (): string | null => null}},
        scroll: {element: {classList: {contains: () => false}}}};
    const exports = {} as typeof import("./event");
    const source = transpileModule(readFileSync(join(__dirname, "event.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    new Function("exports", "require", "window", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", source)(exports,
        () => ({Constants: {TIMEOUT_LOAD: 100}, isMobile: () => false, hideElements: () => {}}),
        {siyuan: {}, setTimeout: (cb: () => void) => { timers.set(1, cb); return 1; }},
        (id: number) => timers.delete(id),
        (cb: () => void) => { frames.set(1, cb); return 1; },
        (id: number) => frames.delete(id));
    exports.scrollEvent(protyle as unknown as IProtyle, element as unknown as HTMLElement);
    listener();
    assert.equal(timers.size, 1);
    assert.equal(frames.size, 1);
    exports.destroyScrollEvent(element as unknown as HTMLElement);
    assert.equal(timers.size, 0);
    assert.equal(frames.size, 0);
    assert.equal(removed, 1);
    exports.destroyScrollEvent(element as unknown as HTMLElement);
    assert.equal(removed, 1);
});

test("scroll bursts scan once per editor frame and use the current database nodes and viewport", () => {
    const frames = new Map<number, () => void>();
    let sequence = 0;
    const calls: string[] = [];
    const exports = {} as typeof import("./event");
    const source = transpileModule(readFileSync(join(__dirname, "event.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    new Function("exports", "require", "window", "requestAnimationFrame", "cancelAnimationFrame", "clearTimeout", source)(exports,
        () => ({isMobile: () => false, hideElements: () => {},
            stickyRow: (item: {id: string}) => calls.push("sticky:" + item.id),
            trimAVRowsSync: (item: {id: string}, rect: {top: number}) => calls.push(`trim:${item.id}:${rect.top}`)}),
        {siyuan: {}}, (callback: () => void) => { frames.set(++sequence, callback); return sequence; },
        (id: number) => frames.delete(id), () => {});
    const createEditor = (id: string) => {
        let listener: () => void;
        let scans = 0;
        const nodes = [{id, dataset: {render: "true"}, isConnected: true}];
        const liveNodes = {
            get length() { return nodes.length; },
            [Symbol.iterator]() { scans++; return nodes.values(); },
        };
        const element = {isConnected: true, scrollTop: 10,
            addEventListener: (_type: string, callback: () => void) => listener = callback,
            removeEventListener: () => {}, setAttribute: () => {},
            getBoundingClientRect: () => ({top: element.scrollTop})};
        const protyle = {contentElement: element, element: {classList: {contains: () => false}},
            toolbar: {element: {classList: {contains: () => true}}}, block: {showAll: true},
            wysiwyg: {element: {getElementsByClassName: () => liveNodes, getAttribute: (): string | null => null}}};
        exports.scrollEvent(protyle as unknown as IProtyle, element as unknown as HTMLElement);
        return {element, nodes, scroll: () => listener(), scans: () => scans};
    };
    const first = createEditor("first");
    const second = createEditor("second");
    for (let i = 0; i < 100; i++) { first.scroll(); second.scroll(); }
    assert.equal(frames.size, 2);
    assert.equal(first.scans(), 0);
    first.nodes.splice(0, 1, {id: "replacement", dataset: {render: "true"}, isConnected: true});
    first.nodes.push({id: "unrendered", dataset: {render: "false"}, isConnected: true});
    first.nodes.push({id: "detached", dataset: {render: "true"}, isConnected: false});
    first.element.scrollTop = 42;
    const flush = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback());
    };
    flush();
    assert.equal(first.scans(), 1);
    assert.equal(second.scans(), 1);
    assert.deepEqual(calls, ["sticky:replacement", "trim:replacement:42", "sticky:second", "trim:second:10"]);
    first.scroll();
    flush();
    assert.equal(first.scans(), 2);
    assert.equal(second.scans(), 1);
    first.scroll();
    exports.destroyScrollEvent(first.element as unknown as HTMLElement);
    assert.equal(frames.size, 0);
    first.nodes.length = 0;
    first.scroll();
    assert.equal(frames.size, 0);
    second.nodes.length = 0;
    second.scroll();
    second.nodes.push({id: "added", dataset: {render: "true"}, isConnected: true});
    second.scroll();
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(calls.slice(-2), ["sticky:added", "trim:added:10"]);
});
