import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {getLeafOpenPaths} from "../src/util/fileTreeOpenPaths.ts";

const legacy = input => {
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
const measure = (run, paths) => {
    const samples = [];
    let result;
    for (let count = 0; count < 3; count++) {
        const start = performance.now();
        result = run(paths);
        samples.push(performance.now() - start);
    }
    return {result, medianMs: samples.sort((a, b) => a - b)[1]};
};
const results = [];
for (const size of [1000, 10000]) {
    const paths = ["/", ...Array.from({length: size}, (_, i) => "/20261015120000-" + i.toString(36).padStart(7, "0") + ".sy")];
    const before = measure(legacy, paths);
    const after = measure(getLeafOpenPaths, paths);
    assert.deepEqual(after.result, before.result);
    results.push({folders: size, beforeMedianMs: before.medianMs, afterMedianMs: after.medianMs, outputsIdentical: true});
}
console.log(JSON.stringify({scope: "Pure expanded-folder state filtering; does not measure whole-app latency", results}, null, 2));
