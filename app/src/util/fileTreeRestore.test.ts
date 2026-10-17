import * as assert from "node:assert/strict";
import test from "node:test";
import {restoreFileTreePaths} from "./fileTreeRestore";

test("loads independent branches concurrently after their shared ancestors finish", async () => {
    const calls: string[] = [];
    const pending = new Map<string, () => void>();
    const restore = restoreFileTreePaths([
        {notebookId: "one", openPaths: ["/a/b/leaf.sy", "/a/c/leaf.sy", "/a/b/other.sy"]},
        {notebookId: "two", openPaths: ["/x/leaf.sy"]},
        {notebookId: "one", openPaths: ["//a/b/leaf.sy"]},
    ], async (notebookId, path) => {
        const key = `${notebookId}:${path}`;
        calls.push(key);
        await new Promise<void>(resolve => pending.set(key, resolve));
    });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ["one:/", "two:/"]);
    pending.get("one:/")();
    await flush();
    assert.equal(calls.length, 2);
    pending.get("two:/")();
    await flush();
    assert.deepEqual(calls.slice(2), ["one:/a.sy", "two:/x.sy"]);
    pending.get("one:/a.sy")();
    pending.get("two:/x.sy")();
    await flush();
    assert.deepEqual(calls.slice(4), ["one:/a/b.sy", "one:/a/c.sy"]);
    pending.get("one:/a/c.sy")();
    pending.get("one:/a/b.sy")();
    await restore;
    assert.equal(calls.length, 6);
});

test("restores only ancestors and leaves root-only and empty saved paths collapsed", async () => {
    const calls: string[] = [];
    await restoreFileTreePaths([
        {notebookId: "one", openPaths: ["/", ""]},
        {notebookId: "two", openPaths: []},
        {notebookId: "three", openPaths: ["/leaf.sy"]},
    ], async (notebookId, path) => {
        calls.push(`${notebookId}:${path}`);
    });
    assert.deepEqual(calls, ["three:/"]);
});

test("a rejected branch does not interrupt restoration of other branches", async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const originalError = console.error;
    const failure = new Error("request failed");
    console.error = error => errors.push(error);
    try {
        await restoreFileTreePaths([
            {notebookId: "one", openPaths: ["/leaf.sy"]},
            {notebookId: "two", openPaths: ["/a/leaf.sy"]},
        ], async (notebookId, path) => {
            if (notebookId === "one") {
                throw failure;
            }
            calls.push(path);
        });
        assert.deepEqual(calls, ["/", "/a.sy"]);
        assert.deepEqual(errors, [failure]);
    } finally {
        console.error = originalError;
    }
});

test("wide restoration bounds active requests and waits for every parent before loading descendants", async () => {
    const pending: (() => void)[] = [];
    const calls: string[] = [];
    let active = 0;
    let peak = 0;
    const restore = restoreFileTreePaths(Array.from({length: 20}, (_, index) => ({
        notebookId: String(index), openPaths: ["/parent/leaf.sy"],
    })), async (notebook, path) => {
        active++;
        peak = Math.max(peak, active);
        calls.push(`${notebook}:${path}`);
        await new Promise<void>(resolve => pending.push(() => {
            active--;
            resolve();
        }));
    });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 6);
    for (let completed = 0; completed < 20; completed++) {
        assert.equal(calls.every(call => call.endsWith(":/")), true);
        pending.shift()();
        await flush();
    }
    assert.equal(calls.length, 26);
    for (let completed = 0; completed < 20; completed++) {
        pending.shift()();
        await flush();
    }
    await restore;
    assert.equal(peak, 6);
    assert.equal(active, 0);
    assert.equal(calls.length, 40);
    assert.equal(new Set(calls).size, 40);
});

test("a failed request frees its slot and subsequent branches still restore", async () => {
    const calls: string[] = [];
    const originalError = console.error;
    const errors: unknown[] = [];
    const failure = new Error("first branch unavailable");
    console.error = error => errors.push(error);
    try {
        await restoreFileTreePaths(Array.from({length: 20}, (_, index) => ({
            notebookId: String(index), openPaths: ["/leaf.sy"],
        })), async notebook => {
            calls.push(notebook);
            if (notebook === "0") {
                throw failure;
            }
        });
        assert.equal(new Set(calls).size, 20);
        assert.deepEqual(errors, [failure]);
    } finally {
        console.error = originalError;
    }
});
