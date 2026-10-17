const assert = require("node:assert/strict");
const {mkdtempSync, mkdirSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sass = require("sass");

const themes = ["daylight", "midnight", "siyuan-cream", "siyuan-forest", "siyuan-ocean", "siyuan-graphite"];

// 检查选中层下真实绘制的文字像素，避免内容仍在 DOM 中却被实色覆盖的回归。
const pixelRange = (picture) => {
    const bitmap = picture.toBitmap();
    let low = 255;
    let high = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
        const value = (bitmap[index] + bitmap[index + 1] + bitmap[index + 2]) / 3;
        low = Math.min(low, value);
        high = Math.max(high, value);
    }
    return high - low;
};

const pixelMean = (picture) => {
    const bitmap = picture.toBitmap();
    let total = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
        total += (bitmap[index] + bitmap[index + 1] + bitmap[index + 2]) / 3;
    }
    return total / (bitmap.length / 4);
};

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
            const css = ["base", "export"].map(name => sass.compile(
                path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css).join("\n");
            const themeCSS = name => readFileSync(path.join(__dirname, "../appearance/themes", name, "theme.css"), "utf8")
                .replace(/@import[^;]+;/g, "");
            for (const theme of themes) {
                const dark = ["midnight", "siyuan-ocean", "siyuan-graphite"].includes(theme);
                const base = dark ? "midnight" : "daylight";
                const palette = themeCSS(base) + (theme === base ? "" : themeCSS(theme));
                await win.loadURL("data:text/html,<html data-frontend='desktop'><head></head><body></body></html>");
                await win.webContents.executeJavaScript(`(() => {
                    const style = document.createElement("style");
                    style.textContent = ${JSON.stringify(css + palette)};
                    document.head.append(style);
                    document.body.innerHTML = '<div class="protyle-wysiwyg" style="padding:24px;color:var(--b3-theme-on-background)">' +
                        '<div id="code" data-node-id="code" data-type="NodeCodeBlock" class="code-block"><div class="hljs"><span id="code-ink">Readable selected code 0123456789</span></div></div>' +
                        '<div id="paragraph" data-node-id="paragraph" class="p"><span id="paragraph-ink">Readable selected paragraph 0123456789</span></div>' +
                        '<div id="tabs" data-node-id="tabs" class="tabs"><div class="tabs-header" style="display:flex"><span id="tabs-ink">Readable selected tabs 0123456789</span></div></div></div>';
                    const inkStyle = document.createElement("style");
                    inkStyle.textContent = ".hljs,#paragraph-ink,#tabs-ink{font:20px/32px monospace;color:var(--b3-theme-on-background)}";
                    document.head.append(inkStyle);
                })()`);
                for (const large of [false, true]) {
                    await win.webContents.executeJavaScript(`(() => {
                        document.documentElement.dataset.uiDensity = ${JSON.stringify(large ? "compact" : "normal")};
                        document.querySelectorAll("[id$='-ink']").forEach(el => el.style.fontSize = ${JSON.stringify(large ? "24px" : "20px")});
                    })()`);
                    for (const state of ["protyle-wysiwyg--select", "protyle-wysiwyg--select-mode", "protyle-wysiwyg--hl"]) {
                        const rectangles = await win.webContents.executeJavaScript(`(() => {
                            document.querySelectorAll("[data-node-id]").forEach(el => {
                                el.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--select-mode", "protyle-wysiwyg--hl");
                                el.classList.add(${JSON.stringify(state)});
                            });
                            document.getAnimations().forEach(animation => animation.finish());
                            return ["code", "paragraph", "tabs"].map(id => {
                                const el = document.getElementById(id + "-ink");
                                const rect = el.getBoundingClientRect();
                                const overlay = getComputedStyle(document.getElementById(id), "::after");
                                return {id, x:Math.ceil(rect.x + 1), y:Math.ceil(rect.y + 1),
                                    width:Math.min(320, Math.floor(rect.width - 2)), height:Math.floor(rect.height - 2),
                                    pointerEvents:overlay.pointerEvents};
                            });
                        })()`);
                        await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                        for (const {id, pointerEvents, ...rect} of rectangles) {
                            const picture = await win.webContents.capturePage(rect);
                            const ink = pixelRange(picture);
                            assert.ok(ink > 35, `${theme} ${state} ${id} large=${large}: selected text must remain painted, range=${ink}`);
                            assert.equal(pointerEvents, "none", "selection overlays must not block clicks");
                            if (!large && state === "protyle-wysiwyg--select") {
                                await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).classList.remove(${JSON.stringify(state)})`);
                                await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                                const unselected = pixelMean(await win.webContents.capturePage(rect));
                                assert.ok(Math.abs(pixelMean(picture) - unselected) > 3,
                                    `${theme} ${id}: selecting a block must retain visible feedback`);
                                await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).classList.add(${JSON.stringify(state)})`);
                                await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                            }
                        }
                    }
                }
            }
            console.log("Selected block text stays visible in six themes");
        } catch (error) {
            console.error(error);
            status = 1;
        } finally {
            win.destroy();
            app.exit(status);
        }
    });
} else {
    require("node:test").test("selected code, paragraphs and tabs remain visibly painted in all bundled themes", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 90000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const folder = mkdtempSync(path.join(os.tmpdir(), "siyuan-selection-visibility-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, folder], {env, timeout: 85000, windowsHide: true});
            assert.match(stdout, /Selected block text stays visible in six themes/);
        } finally {
            assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(folder).startsWith("siyuan-selection-visibility-"));
            rmSync(folder, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
