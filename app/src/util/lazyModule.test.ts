import {strict as assert} from "node:assert";
import {test} from "node:test";
import {createLazyModuleLoader} from "./lazyModule";

test("optional modules load only on demand and concurrent callers share the loaded module", async () => {
    let calls = 0;
    const module = {value: 42};
    const load = createLazyModuleLoader(async () => { calls++; return module; });
    assert.equal(calls, 0);
    const results = await Promise.all(Array.from({length: 100}, () => load()));
    assert.equal(calls, 1);
    assert.ok(results.every(value => value === module));
    assert.equal(await load(), module);
    assert.equal(calls, 1);
});

test("optional module loading failures do not poison subsequent attempts", async () => {
    let calls = 0;
    const load = createLazyModuleLoader(async () => {
        if (++calls === 1) { throw new Error("load failed"); }
        return "loaded";
    });
    await assert.rejects(load, /load failed/);
    assert.equal(await load(), "loaded");
    assert.equal(calls, 2);
});
