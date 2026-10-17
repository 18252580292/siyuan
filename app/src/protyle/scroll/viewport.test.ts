import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {getVisibleRootBlockID, getVisibleRootBlockIDFromElements, isScrolledToBottom} from "./viewport";

describe("getVisibleRootBlockID", () => {
    const blocks = [
        {id: "first", top: -100, bottom: 80},
        {id: "second", top: 88, bottom: 240},
        {id: "third", top: 248, bottom: 400},
    ];

    it("returns the first root block intersecting the viewport", () => {
        assert.equal(getVisibleRootBlockID(blocks, 10, 300), "first");
        assert.equal(getVisibleRootBlockID(blocks, 90, 300), "second");
    });

    it("ignores blocks without an id and blocks outside the viewport", () => {
        assert.equal(getVisibleRootBlockID([{id: null, top: 0, bottom: 100}, ...blocks], 90, 240), "second");
        assert.equal(getVisibleRootBlockID(blocks, 500, 700), undefined);
    });
});

describe("visible block layout measurements", () => {
    it("stops measuring a large document at the first visible block", () => {
        let measurements = 0;
        const blocks = Array.from({length: 10000}, (_, index) => ({
            getAttribute: () => `block-${index}`,
            getBoundingClientRect: () => {
                measurements++;
                return {top: index * 40, bottom: index * 40 + 40};
            },
        } as unknown as Element));
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 10, 600), "block-0");
        assert.equal(measurements, 1);
        measurements = 0;
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 4010, 4600), "block-100");
        assert.ok(measurements <= 16, `Measured ${measurements} blocks`);
    });

    it("preserves DOM ordering and skips elements without block identities", () => {
        const blocks = [
            {getAttribute: (): string | null => null, getBoundingClientRect: () => assert.fail("non-blocks need no layout measurement")},
            {getAttribute: () => "first", getBoundingClientRect: () => ({top: -100, bottom: 80})},
            {getAttribute: () => "second", getBoundingClientRect: () => ({top: 88, bottom: 240})},
        ] as unknown as Element[];
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 90, 240), "second");
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 500, 700), undefined);
    });
});

describe("indexed viewport location", () => {
    it("matches sequential lookup for variable-height blocks, gaps and deep jumps", () => {
        let top = -20;
        let reads = 0;
        const geometry = Array.from({length: 10000}, (_, index) => {
            const block = {id: `block-${index}`, top, bottom: top + 10 + index % 83};
            top = block.bottom + index % 7;
            return block;
        });
        const blocks = geometry.map(block => ({getAttribute: () => block.id,
            getBoundingClientRect: () => { reads++; return block; }}) as unknown as Element);
        for (const index of [0, 1, 37, 4999, 9999]) {
            for (const offset of [-1, 0, 1, 70]) {
                const viewportTop = geometry[index].top + offset;
                reads = 0;
                assert.equal(getVisibleRootBlockIDFromElements(blocks, viewportTop, viewportTop + 300),
                    getVisibleRootBlockID(geometry, viewportTop, viewportTop + 300));
                assert.ok(reads <= 16, `Deep scroll measured ${reads} blocks`);
            }
        }
        assert.equal(getVisibleRootBlockIDFromElements(blocks, top + 1, top + 500), undefined);
    });

    it("reads live geometry after edits and falls back for hidden or non-block probes", () => {
        const geometry = Array.from({length: 100}, (_, index) => ({id: `block-${index}`, top: index * 20, bottom: index * 20 + 20}));
        const blocks = geometry.map(block => ({getAttribute: () => block.id, getBoundingClientRect: () => block}) as unknown as Element);
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 1601, 1800), "block-80");
        geometry.forEach(block => { block.top += 100; block.bottom += 100; });
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 1601, 1800), "block-75");
        geometry[50].top = 0;
        geometry[50].bottom = 0;
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 1601, 1800), "block-75");
        geometry[50].id = null;
        assert.equal(getVisibleRootBlockIDFromElements(blocks, 1601, 1800), "block-75");
    });
});

describe("isScrolledToBottom", () => {
    it("allows fractional pixel differences at the bottom", () => {
        assert.equal(isScrolledToBottom(699.5, 1000, 300), true);
        assert.equal(isScrolledToBottom(698, 1000, 300), false);
    });
});
