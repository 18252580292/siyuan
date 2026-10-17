import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {ContractFormData} from "../../util/contractFormData";
import {createLazyModuleLoader} from "../../util/lazyModule";

test("encrypted notebook system lock is offered only for supported local desktop kernels", () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {registerEncryptedNotebookGroup};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const [os, browser, mobile, ownsKernel, expected] of [
        ["windows", false, false, true, true],
        ["darwin", false, false, true, true],
        ["linux", false, false, true, false],
        ["windows", true, false, true, false],
        ["windows", false, false, false, false],
        ["darwin", false, true, true, false],
    ] as const) {
        const switches: Array<{id: string, save: (value: unknown) => void}> = [];
        const requests: Array<{url: string, enabled: boolean}> = [];
        const system = {os, encryptedNotebookFollowSystemLock: false};
        let confirmSave: () => void;
        const dependencies = {
            createLazyModuleLoader,
            isBrowser: () => browser,
            isMobile: () => mobile,
            getHostCapabilities: () => ({ownsKernel, importExport: ownsKernel}),
            fetchPost: (url: string, data: {enabled: boolean}, callback: () => void) => {
                requests.push({url, enabled: data.enabled});
                confirmSave = callback;
            },
        };
        const exports = {} as {registerEncryptedNotebookGroup: (tab: unknown) => void};
        runInNewContext(compiled, {
            exports,
            require: () => dependencies,
            window: {siyuan: {config: {readonly: false, system}, languages: {}}},
        });
        exports.registerEncryptedNotebookGroup({group: () => ({
            slot: () => {},
            button: () => {},
            number: () => {},
            switch: (id: string, spec: {save: (value: unknown) => void}) => switches.push({id, save: spec.save}),
        })});
        assert.equal(switches.length, expected ? 1 : 0);
        if (expected) {
            assert.equal(switches[0].id, "system.encryptedNotebookFollowSystemLock");
            switches[0].save(true);
            assert.equal(system.encryptedNotebookFollowSystemLock, false);
            confirmSave();
            assert.equal(system.encryptedNotebookFollowSystemLock, true);
            switches[0].save(false);
            assert.equal(system.encryptedNotebookFollowSystemLock, true);
            confirmSave();
            assert.equal(system.encryptedNotebookFollowSystemLock, false);
            switches[0].save("true");
            assert.deepEqual(requests, [
                {url: "/api/notebook/setEncryptedNotebookFollowSystemLock", enabled: true},
                {url: "/api/notebook/setEncryptedNotebookFollowSystemLock", enabled: false},
            ]);
        }
    }
});

test("crypto backup import trims passwords and rejects whitespace-only input", async () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {mountEncryptedNotebook};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const listeners = new Map<string, () => void>();
    const root = {
        querySelector: (selector: string) => ({
            querySelector: (child: string) => root.querySelector(child),
            addEventListener: (_event: string, callback: () => void) => listeners.set(selector, callback),
        }),
    };
    const file = new Blob(["backup"], {type: "application/json"});
    const input = {files: [file], onchange: (): void => undefined, click() { this.onchange(); }};
    let confirm: (value: string, dialog: {destroy: () => void}) => void;
    const requests: FormData[] = [];
    let destroyed = 0;
    const dependencies = {
        createLazyModuleLoader,
        ContractFormData,
        getHostCapabilities: () => ({importExport: true}),
        fetchPost: (): void => undefined,
        fetchSyncPost: async (url: string, data: FormData) => {
            assert.equal(url, "/api/notebook/importNotebookCryptoBackup");
            requests.push(data);
            return {code: 0};
        },
        openInputDialog: (options: {onConfirm: typeof confirm}) => { confirm = options.onConfirm; },
        showMessage: (): void => undefined,
    };
    const exports = {} as {mountEncryptedNotebook: (element: typeof root) => void};
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        document: {createElement: () => input},
        window: {siyuan: {languages: {}}},
    });
    exports.mountEncryptedNotebook(root);
    listeners.get("#importCryptoBackupBtn")();
    const dialog = {destroy: () => { destroyed++; }};
    confirm("", dialog);
    confirm("   ", dialog);
    confirm("\t\u00a0\u3000\n", dialog);
    assert.equal(requests.length, 0);
    for (const password of [" password ", "\tpassword\n", "\u00a0password\u3000"]) {
        confirm(password, dialog);
        await Promise.resolve();
        assert.equal(requests[requests.length - 1].get("password"), password.trim());
        assert.ok(requests[requests.length - 1].get("file") instanceof Blob);
    }
    assert.equal(destroyed, 3);
});

test("recovery-required key configuration can be disabled and cannot import another archive", () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {refreshEncryptedNotebookStatus};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const controls = new Map<string, {checked: boolean, disabled: boolean, classList: {toggle: () => void, remove: () => void}}>();
    const root = {
        querySelector: (selector: string) => {
            if (!controls.has(selector)) {
                controls.set(selector, {checked: false, disabled: false, classList: {toggle: () => {}, remove: () => {}}});
            }
            return controls.get(selector);
        },
    };
    let state = "RecoveryRequired";
    const dependencies = {
        createLazyModuleLoader,
        getHostCapabilities: () => ({importExport: true}),
        fetchPost: (url: string, data: object, callback: (response: unknown) => void) => {
            assert.equal(url, "/api/notebook/getEncryptedNotebookStatus");
            assert.equal(Object.keys(data).length, 0);
            callback({data: {state, migrationPending: false}});
        },
    };
    const config = {notebookCrypto: {enabled: false}};
    const exports = {} as {refreshEncryptedNotebookStatus: (element: typeof root) => void};
    runInNewContext(compiled, {exports, require: () => dependencies, window: {siyuan: {config}}});
    exports.refreshEncryptedNotebookStatus(root);
    assert.equal(root.querySelector("#encryptedNotebookSwitch").checked, true);
    assert.equal(root.querySelector("#restoreEncryptedNotebooks").disabled, true);
    assert.equal(config.notebookCrypto.enabled, false);
    state = "Disabled";
    exports.refreshEncryptedNotebookStatus(root);
    assert.equal(root.querySelector("#encryptedNotebookSwitch").checked, false);
    assert.equal(root.querySelector("#restoreEncryptedNotebooks").disabled, false);
});

test("lazy password strength retains weak-password confirmation and rejects cancelled or failed checks", async () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {confirmWeakPassword, updatePasswordStrength};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let loads = 0;
    let confirms = 0;
    let warnings = 0;
    let messages = 0;
    const exports = {} as {confirmWeakPassword: (password: string, confirmed: () => void, current: () => boolean) => Promise<void>};
    runInNewContext(compiled, {exports, require: (name: string) => {
        if (name === "./passwordEstimator") { loads++; return {estimatePassword: (password: string) => password === "123" ? 0 : 4}; }
        return {createLazyModuleLoader, confirmDialog: (_title: string, _message: string, confirmed: () => void) => { warnings++; confirmed(); },
            showMessage: () => messages++};
    }, window: {siyuan: {languages: {}}}});
    assert.equal(loads, 0);
    await exports.confirmWeakPassword("123", () => confirms++, () => true);
    assert.equal(warnings, 1);
    assert.equal(confirms, 1);
    await exports.confirmWeakPassword("a-strong-fixture", () => confirms++, () => false);
    assert.equal(confirms, 1);
    await exports.confirmWeakPassword("a-strong-fixture", () => confirms++, () => true);
    assert.equal(confirms, 2);
    assert.equal(loads, 1);
    assert.equal(messages, 0);
    const failed = {} as typeof exports;
    runInNewContext(compiled, {exports: failed, require: () => ({
        createLazyModuleLoader: () => async () => { throw new Error("module unavailable"); },
        showMessage: () => messages++,
    }), window: {siyuan: {languages: {}}}});
    await failed.confirmWeakPassword("123", () => confirms++, () => true);
    assert.equal(confirms, 2);
    assert.equal(messages, 1);
});

test("a pending weak-password warning cannot confirm after its owning inputs become stale", async () => {
    const source = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {confirmWeakPassword};", {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    let warning: () => void;
    let current = true;
    let confirmed = 0;
    const exports = {} as {confirmWeakPassword: (password: string, callback: () => void, current: () => boolean) => Promise<void>};
    runInNewContext(source, {exports, window: {siyuan: {languages: {}}}, require: (name: string) =>
        name === "./passwordEstimator" ? {estimatePassword: () => 0} : {
            createLazyModuleLoader, confirmDialog: (_title: string, _message: string, callback: () => void) => { warning = callback; },
        }});
    await exports.confirmWeakPassword("fixture", () => confirmed++, () => current);
    assert.equal(typeof warning, "function");
    current = false;
    warning();
    assert.equal(confirmed, 0);
});

test("master-password checks discard changed values and superseded enable submissions", async () => {
    const source = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {openEnableEncryptedDialog, openChangeMasterPasswordDialog};", {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const settle = () => new Promise(resolve => setImmediate(resolve));
    for (const kind of ["enable", "change"] as const) {
        let resolveEstimator: (value: {estimatePassword: () => number}) => void;
        const estimator = new Promise<{estimatePassword: () => number}>(resolve => { resolveEstimator = resolve; });
        const requests: {url: string, data: object}[] = [];
        const control = (value: string) => ({value, checked: true, disabled: false, focus() {}, addEventListener() {}});
        const inputs = [control("old-fixture"), control("new-fixture"), control("new-fixture")];
        if (kind === "enable") inputs[0].value = inputs[1].value;
        const clicks: (() => void)[] = [];
        const buttons = [0, 1].map(index => ({addEventListener: (_type: string, callback: () => void) => { clicks[index] = callback; }}));
        const risk = control("");
        const element = {isConnected: true, querySelectorAll: (selector: string) => selector === "input" ? inputs : buttons,
            querySelector: (selector: string) => selector === "#encRiskConfirm" ? risk : {isConnected: true, classList: {add() {}, remove() {}}}};
        const exports = {} as {openEnableEncryptedDialog: (done: () => void, cancel: () => void) => void,
            openChangeMasterPasswordDialog: () => void};
        runInNewContext(source, {exports, window: {siyuan: {languages: {}}}, require: (name: string) => {
            if (name === "./passwordEstimator") return estimator;
            return {createLazyModuleLoader, Dialog: class {element = element; destroy() { element.isConnected = false; }},
                isMobile: () => false, showMessage: () => {}, fetchSyncPost: async (url: string, data: object) => {
                    requests.push({url, data}); return {code: 0};
                }};
        }});
        if (kind === "enable") exports.openEnableEncryptedDialog(() => {}, () => {});
        else exports.openChangeMasterPasswordDialog();
        clicks[1]();
        await settle();
        inputs[1].value = "changed-fixture";
        resolveEstimator({estimatePassword: () => 4});
        await settle();
        assert.equal(requests.length, 0);
        if (kind === "enable") inputs[0].value = inputs[1].value;
        else inputs[2].value = inputs[1].value;
        clicks[1]();
        clicks[1]();
        await settle();
        assert.equal(requests.length, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), kind === "enable" ? {
            url: "/api/notebook/enableEncryptedNotebooks", data: {password: "changed-fixture"},
        } : {
            url: "/api/notebook/changeMasterPassword", data: {oldPassword: "old-fixture", newPassword: "changed-fixture"},
        });
    }
});

for (const kind of ["enable", "change"] as const) {
    test(`${kind} password submission stays single-flight until the kernel responds and permits retry`, async () => {
        const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
            "\nexport {openEnableEncryptedDialog, openChangeMasterPasswordDialog};",
        {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        const settle = () => new Promise(resolve => setImmediate(resolve));
        const clicks: (() => void)[] = [];
        const buttons = [0, 1].map(index => ({disabled: false,
            addEventListener: (_type: string, callback: () => void) => { clicks[index] = callback; }}));
        const inputs = ["old-fixture", "new-fixture", "new-fixture"].map(value => ({value, focus() {}, addEventListener() {}}));
        if (kind === "enable") inputs[0].value = inputs[1].value;
        const risk = {checked: true, addEventListener() {}};
        const element = {isConnected: true, querySelectorAll: (selector: string) => selector === "input" ? inputs : buttons,
            querySelector: (selector: string) => selector === "#encRiskConfirm" ? risk : {classList: {add() {}, remove() {}}}};
        const pending: {resolve: (response: {code: number, msg: string}) => void, reject: (error: Error) => void}[] = [];
        let messages = 0;
        const exports = {} as {openEnableEncryptedDialog: (done: () => void, cancel: () => void) => void,
            openChangeMasterPasswordDialog: () => void};
        runInNewContext(compiled, {exports, window: {siyuan: {languages: {}}}, require: (name: string) => {
            if (name === "./passwordEstimator") return {estimatePassword: () => 4};
            return {createLazyModuleLoader, Dialog: class {element = element; destroy() { element.isConnected = false; }},
                isMobile: () => false, showMessage() { messages++; },
                fetchSyncPost: () => new Promise((resolve, reject) => pending.push({resolve, reject})),
            };
        }});
        if (kind === "enable") exports.openEnableEncryptedDialog(() => {}, () => {});
        else exports.openChangeMasterPasswordDialog();
        clicks[1]();
        await settle();
        assert.equal(pending.length, 1);
        clicks[1]();
        await settle();
        assert.equal(pending.length, 1, "a second click must not start a concurrent password mutation");
        assert.equal(buttons[1].disabled, true);
        pending[0].resolve({code: -1, msg: "retry fixture"});
        await settle();
        assert.equal(buttons[1].disabled, false);
        clicks[1]();
        await settle();
        assert.equal(pending.length, 2);
        const previousMessages = messages;
        pending[1].reject(new Error("network fixture"));
        await settle();
        assert.equal(messages, previousMessages + 1);
        assert.equal(buttons[1].disabled, false);
        clicks[1]();
        await settle();
        assert.equal(pending.length, 3);
        pending[2].resolve({code: 0, msg: ""});
        await settle();
        assert.equal(element.isConnected, false);
    });
}
