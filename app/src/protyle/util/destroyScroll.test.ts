import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {ModuleKind, transpileModule} from "typescript";

test("the editor destroy lifecycle cancels pending scroll work before disposing an attached editor", () => {
    const timers = new Map<number, () => void>();
    const frames = new Map<number, () => void>();
    const listeners = new Set<() => void>();
    const noop = () => {};
    const events = {} as typeof import("../scroll/event");
    const compile = (name: string) => transpileModule(readFileSync(join(__dirname, name), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    new Function("exports", "require", "window", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", compile("../scroll/event.ts"))(
        events, () => ({Constants: {TIMEOUT_LOAD: 100}, hideElements: noop, isMobile: () => false}),
        {siyuan: {}, setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; }},
        (id: number) => timers.delete(id), (callback: () => void) => { frames.set(1, callback); return 1; },
        (id: number) => frames.delete(id));
    const element = {isConnected: true, scrollTop: 10,
        addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
        removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback), setAttribute: noop};
    let disposed = false;
    const protyle = {
        element: {classList: {contains: () => false, remove: noop}, removeAttribute: noop}, contentElement: element,
        toolbar: {element: {classList: {contains: () => true}}}, block: {showAll: true},
        scroll: {element: {classList: {contains: () => false}}},
        wysiwyg: {element: {getElementsByClassName: () => [{dataset: {render: "true"}}], getAttribute: (): string | null => null},
            destroy() { assert.equal(listeners.size, 0); assert.equal(timers.size, 0); assert.equal(frames.size, 0); disposed = true; }},
    } as unknown as IProtyle;
    events.scrollEvent(protyle, element as unknown as HTMLElement);
    [...listeners][0]();
    assert.equal(frames.size, 1);
    assert.equal(timers.size, 1);
    const exported = {} as typeof import("./destroy");
    const dependencies = new Proxy({}, {get: () => noop});
    new Function("exports", "require", compile("destroy.ts"))(exported,
        (name: string) => name === "../scroll/event" ? events : dependencies);
    exported.destroy(protyle);
    assert.ok(disposed);
    assert.equal(element.isConnected, true);
    assert.equal(listeners.size, 0);
});
