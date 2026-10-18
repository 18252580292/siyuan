const assert = require("node:assert/strict");
const {mkdtempSync, mkdirSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sass = require("sass");
const {bundledThemeNames} = require("../electron/bundledThemes");

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    for (const name of ["home", "appData", "userData"]) {
        const folder = path.join(process.argv[2], name);
        mkdirSync(folder, {recursive: true});
        app.setPath(name, folder);
    }
    app.setAsDefaultProtocolClient = () => false;
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 900, height: 700,
            webPreferences: {backgroundThrottling: false}});
        let status = 0;
        try {
            const css = sass.compile(path.join(__dirname, "../src/assets/scss/base.scss"), {
                logger: sass.Logger.silent,
            }).css;
            const themeCSS = name => readFileSync(path.join(__dirname, "../appearance/themes", name, "theme.css"), "utf8")
                .replace(/@import[^;]+;/g, "");
            for (const theme of ["daylight", "midnight", ...bundledThemeNames]) {
                const dark = theme === "midnight" || (theme !== "daylight" && JSON.parse(readFileSync(
                    path.join(__dirname, "../appearance/themes", theme, "theme.json"), "utf8")).modes.includes("dark"));
                const base = dark ? "midnight" : "daylight";
                await win.loadURL("data:text/html,<html data-frontend='desktop'><head></head><body></body></html>");
                await win.webContents.executeJavaScript(`(() => {
                    const style = document.createElement("style");
                    style.textContent = ${JSON.stringify(css + themeCSS(base) + (theme === base ? "" : themeCSS(theme)))};
                    document.head.append(style);
                    document.body.innerHTML = '<button id="enabled" class="b3-button">Action</button>' +
                        '<button id="button" class="b3-button" disabled>Disabled</button>' +
                        '<button id="cancel" class="b3-button b3-button--cancel" disabled>Disabled cancel</button>' +
                        '<input id="field" class="b3-text-field" disabled value="Disabled field">' +
                        '<select id="select" class="b3-select" disabled><option>Disabled option</option></select>' +
                        '<input id="readonly" class="b3-text-field" readonly value="Copy this text">';
                    document.body.style.padding = "30px";
                    window.controlSnapshot = id => {
                        document.getAnimations().forEach(animation => animation.finish());
                        const s = getComputedStyle(document.getElementById(id));
                        return {background:s.backgroundColor, shadow:s.boxShadow, cursor:s.cursor, opacity:s.opacity};
                    };
                })()`);
                win.webContents.debugger.attach("1.3");
                const {root} = await win.webContents.debugger.sendCommand("DOM.getDocument");
                for (const id of ["button", "cancel", "field", "select"]) {
                    const before = await win.webContents.executeJavaScript(`controlSnapshot(${JSON.stringify(id)})`);
                    const {nodeId} = await win.webContents.debugger.sendCommand("DOM.querySelector", {
                        nodeId: root.nodeId, selector: "#" + id,
                    });
                    await win.webContents.debugger.sendCommand("CSS.enable");
                    await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: ["hover", "active"]});
                    const after = await win.webContents.executeJavaScript(`controlSnapshot(${JSON.stringify(id)})`);
                    assert.deepEqual(after, before, `${theme}: disabled ${id} retains its disabled appearance on hover and press`);
                    assert.equal(after.cursor, "not-allowed");
                    assert.ok(Number(after.opacity) < 1);
                    assert.equal(await win.webContents.executeJavaScript(`(() => {
                        const el = document.getElementById(${JSON.stringify(id)}); el.focus(); return document.activeElement === el;
                    })()`), false, "disabled controls cannot acquire focus");
                }
                const readonly = await win.webContents.executeJavaScript(`(() => {
                    const el = document.getElementById("readonly");
                    el.focus(); el.select();
                    return {focused:document.activeElement === el, selected:el.selectionEnd - el.selectionStart,
                        value:el.value, opacity:getComputedStyle(el).opacity};
                })()`);
                assert.equal(readonly.focused, true);
                assert.equal(readonly.selected, readonly.value.length, "read-only text remains selectable for copying");
                assert.equal(readonly.opacity, "1");
                await win.webContents.executeJavaScript("document.getElementById('enabled').focus()");
                const {nodeId} = await win.webContents.debugger.sendCommand("DOM.querySelector", {
                    nodeId: root.nodeId, selector: "#enabled",
                });
                await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: ["focus-visible"]});
                const focus = await win.webContents.executeJavaScript(`(() => {
                    document.getAnimations().forEach(animation => animation.finish());
                    const el = document.getElementById("enabled"), s = getComputedStyle(el);
                    return {visible:el.matches(":focus-visible"), outline:s.outlineWidth, style:s.outlineStyle};
                })()`);
                assert.equal(focus.visible, true);
                assert.equal(focus.outline, "2px");
                assert.equal(focus.style, "solid");
                win.webContents.debugger.detach();
            }
            console.log("Shared controls preserve disabled, read-only and keyboard-focus states in all bundled themes");
        } catch (error) {
            console.error(error);
            status = 1;
        } finally {
            win.destroy();
            app.exit(status);
        }
    });
} else {
    require("node:test").test("shared controls retain distinct disabled, read-only and keyboard-focus states", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 90000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const folder = mkdtempSync(path.join(os.tmpdir(), "siyuan-control-states-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, folder], {env, timeout: 85000, windowsHide: true});
            assert.match(stdout, /Shared controls preserve disabled/);
        } finally {
            rmSync(folder, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
