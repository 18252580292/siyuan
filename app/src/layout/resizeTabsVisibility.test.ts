import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

test("settled pane resizing reveals the selected tab without changing editor focus", () => {
    const source = readFileSync(path.join(__dirname, "tabUtil.ts"), "utf8");
    const resizeSource = source.slice(source.indexOf("let resizeTimeout:"), source.indexOf("export const getDockByType"));
    const wndSource = createSourceFile("Wnd.ts", readFileSync(path.join(__dirname, "Wnd.ts"), "utf8"), ScriptTarget.Latest, true);
    const wnd = wndSource.statements.find(isClassDeclaration);
    const method = wnd.members.find(member => member.name?.getText(wndSource) === "showHeading");
    const compile = (text: string) => transpileModule(text.replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const TestWnd = new Function(compile(`class TestWnd {${method.getText(wndSource)}}`) + "return TestWnd;")();
    for (const detached of [false, true]) {
        const timers = new Map<number, () => void>();
        let serial = 0;
        let saves = 0;
        const current = {offsetLeft: 500, clientWidth: 200};
        const pane = new TestWnd();
        pane.headersElement = {scrollLeft: 0, clientWidth: 240, querySelector: () => current};
        const hidden = new TestWnd();
        hidden.headersElement = {scrollLeft: 0, clientWidth: 0, querySelector: () => current};
        const center = {name: "center"};
        const windowLayout = {name: "detached"};
        const resize = new Function("window", "clearTimeout", "requestResponsiveDockLayout", "hideAllElements",
            "getAllModels", "pdfResize", "saveLayout", "getAllWnds", "isWindow",
            compile(resizeSource) + "return resizeTabs;")({
            siyuan: {layout: {centerLayout: center, layout: windowLayout}},
            setTimeout: (callback: () => void) => {timers.set(++serial, callback); return serial;},
        }, (id: number) => timers.delete(id), () => {}, () => {},
        (): Record<string, never[]> => ({editor: [], backlink: [], search: [], custom: []}), () => {}, () => {saves++;},
        (layout: unknown, panes: unknown[]) => {
            assert.equal(layout, detached ? windowLayout : center);
            panes.push(pane, hidden);
        }, () => detached);
        resize(true);
        resize(false);
        assert.equal(timers.size, 1, "rapid resize events keep one existing debounce timer");
        [...timers.values()][0]();
        assert.ok(current.offsetLeft >= pane.headersElement.scrollLeft);
        assert.ok(current.offsetLeft + current.clientWidth <= pane.headersElement.scrollLeft + pane.headersElement.clientWidth,
            "the selected tab is visible after the pane narrows");
        assert.equal(hidden.headersElement.scrollLeft, 0, "hidden panes retain their header scroll position");
        assert.equal(saves, 1, "the batched layout-save request is preserved");
    }
});
