import {strict as assert} from "node:assert";
import {test} from "node:test";
import {getLeafOpenPaths, getNotebookOpenPaths} from "./fileTreeOpenPaths";

const id = (value: number) => "20261015120000-" + value.toString(36).padStart(7, "0");
const legacy = (input: string[]) => {
    const paths = input.slice();
    for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
            if (paths[j].startsWith(paths[i].replace(".sy", ""))) {
                paths.splice(i, 1);
                j--;
            }
        }
    }
    return paths;
};

test("open paths keep the original order, leaf folders, roots and legacy prefix behavior", () => {
    const a = "/" + id(1);
    const b = "/" + id(2);
    for (const paths of [[], ["/"], ["/", a + ".sy", a + "/" + id(3) + ".sy", b + ".sy"],
        [a + ".sy", b + ".sy", b + "/" + id(4) + ".sy", a + "/" + id(3) + ".sy"],
        [a + ".sy", a + ".sy"], ["/a.sy", "/ab.sy", "/a/c.sy"], ["/", "/legacy.sy", "/"]]) {
        const before = paths.slice();
        assert.deepEqual(getLeafOpenPaths(paths), legacy(paths));
        assert.deepEqual(paths, before);
    }
});

test("canonical preorder and temporarily reordered paths match the previous serialization", () => {
    let random = 117;
    const next = (max: number) => { random = (random * 1664525 + 1013904223) >>> 0; return random % max; };
    for (let sample = 0; sample < 600; sample++) {
        const paths: string[] = ["/"];
        for (let folder = 0; folder < 15; folder++) {
            const parent = "/" + id(folder);
            paths.push(parent + ".sy");
            for (let child = 0; child < next(5); child++) {
                paths.push(parent + "/" + id(100 + child) + ".sy");
            }
        }
        assert.deepEqual(getLeafOpenPaths(paths), legacy(paths));
        for (let i = paths.length - 1; i > 0; i--) {
            const j = next(i + 1);
            [paths[i], paths[j]] = [paths[j], paths[i]];
        }
        assert.deepEqual(getLeafOpenPaths(paths), legacy(paths));
    }
});

test("collecting expanded paths scans once and uses existing rows to find their first child", () => {
    let scans = 0;
    const paths = ["/", "/" + id(1) + ".sy", "/" + id(1) + "/" + id(3) + ".sy", "/" + id(2) + ".sy"];
    const childPath = "/" + id(1) + "/" + id(3) + "/" + id(4) + ".sy";
    const rows = paths.map((path, index) => ({
        getAttribute: () => path,
        nextElementSibling: index === 2 ? {firstElementChild: {getAttribute: () => childPath}} : null,
    }));
    const notebook = {querySelectorAll(selector: string) {
        assert.equal(selector, ".b3-list-item__arrow--open");
        scans++;
        return rows.map(row => ({closest: () => row}));
    }} as unknown as Element;
    assert.deepEqual(getNotebookOpenPaths(notebook), [childPath, paths[3]]);
    assert.equal(scans, 1);
});

test("ten thousand sibling folders do not perform pairwise prefix comparisons", () => {
    const paths = ["/", ...Array.from({length: 10000}, (_, i) => "/" + id(i) + ".sy")];
    const original = String.prototype.startsWith;
    let comparisons = 0;
    try {
        String.prototype.startsWith = function(search: string, position?: number) {
            comparisons++;
            return original.call(this, search, position);
        };
        assert.deepEqual(getLeafOpenPaths(paths), paths.slice(1));
    } finally {
        String.prototype.startsWith = original;
    }
    assert.equal(comparisons, 0);
});
