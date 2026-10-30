import * as assert from "node:assert/strict";
import {test} from "node:test";
import {updateFrozenColumns} from "./frozenColumns";
import {loadModule} from "../../../testSupport/loadModule";

test("frozen columns adapt to available width without changing the saved boundary", () => {
    let viewportWidth = 352;
    let frozenWidth = 623;
    const groups = [true, false].map(hasFrozen => ({
        disabled: false,
        querySelector: () => hasFrozen ? {getBoundingClientRect: () => ({width: frozenWidth})} : null,
        classList: {toggle(name: string, value: boolean) {
            assert.equal(name, "av__body--unfreeze");
            groups[hasFrozen ? 0 : 1].disabled = value;
        }},
    }));
    const block = {
        dataset: {avType: "table"},
        querySelector: () => ({get clientWidth() {return viewportWidth;}}),
        querySelectorAll: () => groups,
    } as unknown as HTMLElement;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, true);
    assert.equal(groups[1].disabled, false);
    viewportWidth = 703;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, false);
    frozenWidth = 624;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, true);
    frozenWidth = 200;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, false);
    viewportWidth = 0;
    updateFrozenColumns(block);
    assert.equal(groups[0].disabled, false);
});

test("cell navigation reveals previously frozen cells when freezing is suspended", () => {
    let suspended = true;
    const scroll = {scrollLeft: 600, getBoundingClientRect: () => ({left: 16, right: 368})};
    const row = {
        parentElement: {classList: {contains: () => suspended}},
        querySelector: () => ({contains: () => true}),
    };
    const exports = loadModule<{cellScrollIntoView?: (block: unknown, cell: unknown, onlyHeight: boolean) => void}>(
        "src/protyle/render/av/cell.ts", {
        require: () => ({hasClosestByClassName: (_element: unknown, name: string) => name === "av__row" ? row : null}),
    });
    const block = {querySelector: (name: string) => name === ".av__scroll" ? scroll : null};
    const cell = {getBoundingClientRect: () => ({left: -184, right: 16, width: 200})};
    exports.cellScrollIntoView(block, cell, false);
    assert.equal(scroll.scrollLeft, 400);
    suspended = false;
    exports.cellScrollIntoView(block, cell, false);
    assert.equal(scroll.scrollLeft, 400);
});

test("grouped frozen columns read current geometry before changing positioning classes", () => {
    const events: string[] = [];
    let viewportWidth = 300;
    const widths = [220, 221, 500];
    const states: boolean[] = [];
    const bodies = widths.map((_width, index) => ({
        querySelector: () => ({getBoundingClientRect: () => {
            events.push("read:" + index);
            return {width: widths[index]};
        }}),
        classList: {toggle: (_name: string, suspended: boolean) => {
            events.push("write:" + index);
            states[index] = suspended;
        }},
    }));
    bodies.push({querySelector: () => null, classList: {toggle: (_name: string, suspended: boolean) => {
        events.push("write:3");
        states[3] = suspended;
    }}});
    const block = {dataset: {avType: "table"}, querySelector: () => ({get clientWidth() {
        events.push("viewport");
        return viewportWidth;
    }}), querySelectorAll: () => bodies} as unknown as HTMLElement;
    updateFrozenColumns(block);
    assert.deepEqual(events, ["viewport", "read:0", "read:1", "read:2", "write:0", "write:1", "write:2", "write:3"]);
    assert.deepEqual(states, [false, true, true, false]);
    events.length = 0;
    viewportWidth = 600;
    widths[1] = 550;
    updateFrozenColumns(block);
    assert.deepEqual(states, [false, true, false, false]);
    events.length = 0;
    viewportWidth = 0;
    updateFrozenColumns(block);
    assert.deepEqual(events, ["viewport"]);
});
