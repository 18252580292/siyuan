import * as assert from "node:assert/strict";
import {afterEach, beforeEach, test} from "node:test";
import {createOutlineHeadingLookup} from "./outlineHeadingLookup";
Object.assign(globalThis, {SIYUAN_VERSION: "test", NODE_ENV: "test"});
const {operationsMayChangeOutline} = require("./headingNumberCore") as typeof import("./headingNumberCore");

const cssDescriptor = Object.getOwnPropertyDescriptor(globalThis, "CSS");
beforeEach(() => Object.defineProperty(globalThis, "CSS", {configurable: true,
    value: {escape: (id: string) => id.replace(/["\\]/g, "\\$&")}}));
afterEach(() => {
    if (cssDescriptor) { Object.defineProperty(globalThis, "CSS", cssDescriptor); }
    else { Reflect.deleteProperty(globalThis, "CSS"); }
});

const fixture = () => {
    const ids = new Set(["heading", "quoted\"id", "null\u0000id"]);
    let queries = 0;
    let scans = 0;
    const root = {
        querySelector(selector: string) {
            queries++;
            return [...ids].find(id => selector === `.b3-list-item[data-node-id="${CSS.escape(id)}"]`) || null;
        },
        querySelectorAll(selector: string) {
            assert.equal(selector, ".b3-list-item[data-node-id]");
            scans++;
            return [...ids].map(id => ({dataset: {nodeId: id}}));
        },
    } as unknown as HTMLElement;
    return {ids, root, lookup: () => createOutlineHeadingLookup(root), queries: () => queries, scans: () => scans};
};

test("outline transactions query only needed IDs and reuse do/undo membership results", () => {
    const f = fixture();
    const lookup = f.lookup();
    assert.equal(operationsMayChangeOutline(null, lookup), false);
    assert.equal(operationsMayChangeOutline([{action: "move", id: "paragraph"}], lookup), true);
    assert.equal(operationsMayChangeOutline([{action: "updateAttrs", id: "paragraph", data: {old: {}, new: {}}}], lookup), false);
    assert.equal(f.queries(), 0);
    assert.equal(f.scans(), 0);
    const paragraph: IOperation[] = [{action: "update", id: "paragraph", data: '<div data-type="NodeParagraph"></div>'}];
    assert.equal(operationsMayChangeOutline(paragraph, lookup), false);
    assert.equal(operationsMayChangeOutline(paragraph, lookup), false);
    assert.equal(f.queries(), 1);
    assert.equal(f.scans(), 0);
    assert.equal(operationsMayChangeOutline([{...paragraph[0], id: "heading"}], lookup), true);
    assert.equal(f.queries(), 2);
});

test("bulk operations build a single complete index after the bounded individual lookups", () => {
    const f = fixture();
    const lookup = f.lookup();
    for (let i = 0; i < 1000; i++) assert.equal(lookup.has("paragraph-" + i), false);
    assert.equal(lookup.has("heading"), true);
    assert.equal(f.queries(), 8);
    assert.equal(f.scans(), 1);
});

test("known bulk transactions defer their full index until membership is actually needed", () => {
    const f = fixture();
    const lookup = createOutlineHeadingLookup(f.root, 1000);
    assert.equal(operationsMayChangeOutline([{action: "delete", id: "heading"}], lookup), true);
    assert.equal(f.scans(), 0);
    for (let i = 0; i < 1000; i++) assert.equal(lookup.has("paragraph-" + i), false);
    assert.equal(f.queries(), 0);
    assert.equal(f.scans(), 1);
});

test("new transactions see inserted, removed and renamed headings without retaining stale membership", () => {
    const f = fixture();
    assert.equal(f.lookup().has("heading"), true);
    f.ids.delete("heading");
    f.ids.add("renamed");
    const next = f.lookup();
    assert.equal(next.has("heading"), false);
    assert.equal(next.has("renamed"), true);
    assert.equal(next.has('quoted"id'), true);
    assert.equal(next.has("null\u0000id"), true);
    assert.equal(f.scans(), 1);
});

test("outline reload decisions match the full heading set for mixed do and undo operations", () => {
    const f = fixture();
    for (const action of ["append", "delete", "move", "moveOutlineHeading", "swapBlockRef", "appendInsert", "insert",
        "prependInsert", "update", "updateAttrs", "foldHeading", "unfoldHeading"]) {
        for (const id of ["heading", "paragraph", "", 'quoted"id']) {
            for (const data of ['<div data-type="NodeParagraph"></div>', '<div data-type="NodeListItem"></div>',
                {old: {"custom-sy-heading-number": "true"}, new: {}}]) {
                const operation = {action, id, data} as IOperation;
                assert.equal(operationsMayChangeOutline([operation], f.lookup()),
                    operationsMayChangeOutline([operation], f.ids));
            }
        }
    }
});
