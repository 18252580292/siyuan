import {strict as assert} from "node:assert";
import {test} from "node:test";
import {beginSearchPreview, cancelSearchPreview} from "./previewRequest";

test("switching preview cancels both requests and releases observers without affecting another editor", () => {
    const first = {};
    const second = {};
    const task = beginSearchPreview(first, () => true);
    const independent = beginSearchPreview(second, () => true);
    let released = 0;
    task.addCleanup(() => released++);
    const newer = beginSearchPreview(first, () => true);
    assert.equal(task.signal.aborted, true);
    assert.equal(task.isCurrent(), false);
    assert.equal(released, 1);
    assert.equal(independent.isCurrent(), true);
    assert.equal(newer.isCurrent(), true);
    cancelSearchPreview(first);
    assert.equal(newer.signal.aborted, true);
    cancelSearchPreview(second);
});

test("detached previews reject late work and completed cleanup callbacks are not retained", () => {
    const owner = {};
    let connected = true;
    const task = beginSearchPreview(owner, () => connected);
    let released = 0;
    const unregister = task.addCleanup(() => released++);
    unregister();
    connected = false;
    assert.equal(task.isCurrent(), false);
    task.addCleanup(() => released++);
    cancelSearchPreview(owner);
    assert.equal(released, 1);
    cancelSearchPreview(owner);
    assert.equal(released, 1);
});
