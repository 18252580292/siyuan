import {test} from "node:test";
import * as assert from "node:assert/strict";
import {createHomeRequestPool, getHomeCoverURL, getHomeDetailsStatement, getHomeDocs} from "./homeData";

const id = (index: number) => "20261012120000-" + index.toString(36).padStart(7, "0");

test("one hundred concurrent home panels share a pending request, but do not cache settled data", async () => {
    const pool = createHomeRequestPool();
    let calls = 0;
    const request = async () => ++calls;
    const results = await Promise.all(Array.from({length: 100}, () => pool("recent", request)));
    assert.equal(calls, 1);
    assert.equal(results.every(result => result === 1), true);
    assert.equal(await pool("recent", request), 2);
});

test("failed requests are released and different document batches are independent", async () => {
    const pool = createHomeRequestPool();
    await assert.rejects(pool("recent", async () => { throw new Error("offline"); }), /offline/);
    assert.equal(await pool("recent", async () => "new data"), "new data");
    assert.deepEqual(await Promise.all([pool("a", async () => "a"), pool("b", async () => "b")]), ["a", "b"]);
});

test("recent documents skip invalid and duplicate identifiers and stop after eight entries", () => {
    let inspected = 0;
    const data = Array.from({length: 10000}, (_, index) => ({get rootID() { inspected++; return id(index); }}));
    assert.equal(getHomeDocs(data).length, 8);
    assert.ok(inspected < 50);
    assert.deepEqual(getHomeDocs([null, {rootID: "bad' OR 1=1"}, {rootID: id(0)}, {rootID: id(0)}, {rootID: id(1)}]).map(doc => doc.rootID), [id(0), id(1)]);
});

test("recent document dates retain Unix seconds and reject values outside the JavaScript date range", () => {
    assert.equal(getHomeDocs([{rootID: id(0), viewedAt: 1792065600}])[0].viewedAt, 1792065600);
    for (const viewedAt of [Infinity, NaN, -1, 8640000000001]) {
        assert.equal(getHomeDocs([{rootID: id(0), viewedAt}])[0].viewedAt, 0);
    }
});

test("the metadata query caps previews and avoids full-document retrieval and sort work", () => {
    const sql = getHomeDetailsStatement([{rootID: id(0)}]);
    assert.match(sql, /substr\(p.content,1,180\)/);
    assert.match(sql, /b.root_id=d.id LIMIT 16/);
    assert.match(sql, /parent.type IN \('d','h'\)/);
    assert.match(sql, /LIMIT 8$/);
    assert.doesNotMatch(sql, /ORDER BY|markdown|group_concat/i);
    assert.equal(getHomeDetailsStatement([{rootID: "malicious'"}]), "");
});

test("closed notebooks are excluded only by valid IDs without expanding SQL access", () => {
    const sql = getHomeDetailsStatement([{rootID: id(0)}], [id(1), "injected' OR 1=1", id(1)]);
    assert.ok(sql.includes(`d.box NOT IN ('${id(1)}')`));
    assert.ok(!sql.includes("injected"));
    assert.match(sql, /LIMIT 8$/);
});

test("covers accept existing local images and reject remote, encoded traversal and script URLs", () => {
    assert.equal(getHomeCoverURL('background-image: url("assets/my image.png")'), "/assets/my%20image.png");
    assert.equal(getHomeCoverURL('title-img="background-image:url(&quot;assets/cover.png&quot;)" title="Note"'), "/assets/cover.png");
    for (const value of ["https://example.com/a.jpg", "data:image/png;base64,AA==", "javascript:alert(1)",
        "assets/../secret.jpg", "assets/%2e%2e/secret.jpg", "assets/%5c../secret.jpg", "assets/a.svg"]) {
        assert.equal(getHomeCoverURL(`background-image:url('${value}')`), "", value);
    }
});
