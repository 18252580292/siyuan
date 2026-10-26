import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as sass from "sass";
import {themePalettes, getPairedThemeName, getThemePalette} from "./themePalette";

test("bundled preview palettes follow the actual theme variables and only pair available packages", () => {
    for (const [name, palette] of Object.entries(themePalettes)) {
        const css = readFileSync(path.resolve("appearance/themes", name, "theme.css"), "utf8");
        for (const [key, variable] of Object.entries({background: "theme-background", surface: "theme-surface",
            text: "theme-on-background", accent: "theme-primary"})) {
            const matches = Array.from(css.matchAll(new RegExp("--b3-" + variable + ":\\s*(#[a-fA-F0-9]{6})\\s*;", "g")));
            assert.equal(palette[key as keyof typeof palette], matches[matches.length - 1][1].toLowerCase(), name + "/" + key);
        }
    }
    assert.equal(getPairedThemeName("siyuan-chihiro", [{name: "siyuan-chihiro-dark"}]), "siyuan-chihiro-dark");
    assert.equal(getPairedThemeName("siyuan-chihiro", []), undefined);
    assert.equal(getPairedThemeName("third-party", [{name: "third-party-dark"}]), undefined);
    assert.equal(getThemePalette("__proto__"), undefined);
    assert.equal(getThemePalette("constructor"), undefined);
});

const browserCases = async (sources: Record<string, string>, styles: Record<string, string>, themes: {
    name: string; label: string; modes: string[]; frontends: string[];
}[], languages: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    let frontend = "desktop";
    const load = (name: string, dependencies: Record<string, unknown> = {}) =>
        new Function("exports", "require", sources[name] + ";return exports;")({}, (id: string) => {
            check.ok(id in dependencies, "Unexpected dependency: " + id);
            return dependencies[id];
        });
    const palette = load("palette");
    const escape = load("escape");
    const compatibility = load("compatibility");
    const paths = load("paths");
    const picker = load("picker", {"../../util/escape": escape, "../../util/functions": {getFrontend: () => frontend},
        "../../util/themeCompatibility": compatibility, "./themePalette": palette});
    const settings = load("settings", {"../util/dotPath": paths, "./themePicker": picker});
    const saves: Array<{id: string; value: string}> = [];
    let acknowledge = true;
    const api = load("save", {"./mount": {watchSettingTabInteractions: () => {}}, "./item": {
        getSettingItem: (id: string) => ({readValue: (control: HTMLSelectElement) => control.value,
            save: (value: string) => {
                saves.push({id, value});
                if (acknowledge) {
                    (window.siyuan.config.appearance as unknown as Record<string, unknown>)[id.slice("appearance.".length)] = value;
                }
            }}),
    }});
    const lightThemes = themes.filter(theme => theme.modes.includes("light"));
    const darkThemes = themes.filter(theme => theme.modes.includes("dark"));
    window.siyuan = {config: {readonly: false, appearance: {
        lightThemes, darkThemes, themeLight: "siyuan-chihiro", themeDark: "siyuan-catppuccin-mocha", mode: 0,
        modeOS: false, hideStatusBar: false,
    }}, languages} as unknown as ISiyuan;
    const style = document.createElement("style");
    document.head.append(style);
    style.textContent = styles.base + styles.latte;
    document.documentElement.dataset.frontend = "desktop";
    document.documentElement.lang = "zh-CN";
    const root = document.createElement("section");
    root.className = "config";
    root.style.cssText = "width:100%;max-width:800px;box-sizing:border-box;padding:24px;margin:auto";
    root.innerHTML = picker.genThemePickerHTML(true) + '<input id="appearance.globalFontFamilies" value="draft">' +
        '<input id="appearance.hideStatusBar" type="checkbox">';
    document.body.style.margin = "0";
    document.body.style.backgroundColor = "var(--b3-theme-background)";
    document.body.append(root);
    settings.mountAppearanceSettings(root);
    picker.mountThemePickers(root);
    api.bindSettingSaveDelegation(root);
    const light = root.querySelector<HTMLSelectElement>('[data-theme-picker="light"] select');
    const dark = root.querySelector<HTMLSelectElement>('[data-theme-picker="dark"] select');
    const draft = root.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    check.equal(light.selectedOptions[0].textContent.includes("(siyuan-"), false, "visible labels omit package identifiers");
    check.equal(light.title, "siyuan-chihiro", "package identity remains available in the tooltip");
    light.focus();
    light.value = "siyuan-pearl-bay";
    light.dispatchEvent(new Event("change", {bubbles: true}));
    check.equal(saves.length, 1);
    check.equal(saves[0].value, "siyuan-pearl-bay");
    check.equal(root.querySelector<HTMLElement>('[data-theme-picker="light"] [data-theme-preview]').dataset.themeName,
        "siyuan-pearl-bay");
    const match = root.querySelector<HTMLButtonElement>('[data-theme-picker="dark"] button');
    match.focus();
    match.click();
    check.equal(saves.length, 2, "pairing uses the existing setting save route once");
    check.equal(saves[1].id, "appearance.themeDark");
    check.equal(saves[1].value, "siyuan-pearl-bay-dark");
    check.equal(window.siyuan.config.appearance.mode, 0, "pairing does not change the active mode");
    settings.syncAppearanceSettings();

    acknowledge = false;
    light.focus();
    light.value = "siyuan-chihiro";
    light.dispatchEvent(new Event("change", {bubbles: true}));
    draft.focus();
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    check.equal(light.value, "siyuan-chihiro", "blur and older snapshots preserve a pending local theme choice");
    window.siyuan.config.appearance.themeLight = "siyuan-chihiro";
    settings.syncAppearanceSettings();
    acknowledge = true;

    light.focus();
    const originalOption = light.options[0];
    window.siyuan.config.appearance.lightThemes = [...lightThemes,
        {name: "custom", label: '<img src=x onerror="alert(1)"> (custom)', frontends: ["all"]}];
    window.siyuan.config.appearance.hideStatusBar = true;
    draft.value = "unfinished local draft";
    settings.syncAppearanceSettings();
    check.equal(document.activeElement, light);
    check.equal(light.options[0], originalOption, "an open native select retains its option nodes");
    check.equal(light.options.length, lightThemes.length);
    draft.focus();
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    check.equal(light.options.length, lightThemes.length + 1, "theme installation appears after focus leaves");
    check.equal(root.querySelectorAll("img").length, 0, "third-party labels remain plain text");
    check.equal(draft.value, "unfinished local draft");
    check.equal(root.querySelector('input[type="checkbox"]'), root.lastElementChild);
    check.equal((root.lastElementChild as HTMLInputElement).checked, true);
    check.equal(root.querySelector("select"), light, "theme refresh never replaces the form or control nodes");

    for (const mode of [0, 1]) {
        window.siyuan.config.appearance.mode = mode;
        document.documentElement.dataset.themeMode = mode ? "dark" : "light";
        style.textContent = styles.base + (mode ? styles.mocha : styles.latte);
        for (const width of [900, 360]) {
            frontend = width === 360 ? "mobile" : "desktop";
            document.documentElement.dataset.frontend = frontend;
            style.textContent = styles.base + (width === 360 ? styles.mobile : "") + (mode ? styles.mocha : styles.latte);
            root.style.width = width + "px";
            draft.blur();
            settings.syncAppearanceSettings();
            for (const row of root.querySelectorAll<HTMLElement>("[data-theme-picker]")) {
                const rect = row.getBoundingClientRect();
                for (const control of row.querySelectorAll<HTMLElement>("select, button:not([hidden]), .config-theme-preview")) {
                    const box = control.getBoundingClientRect();
                    check.ok(box.left >= rect.left - 1 && box.right <= rect.right + 1,
                        "palette controls stay within the settings width: " + width);
                }
            }
        }
    }
    window.siyuan.config.readonly = true;
    settings.syncAppearanceSettings();
    const count = saves.length;
    match.click();
    check.equal(saves.length, count);
    check.equal(light.disabled, true);
    check.equal(dark.disabled, true);
    window.siyuan.config.readonly = false;
    settings.syncAppearanceSettings();
    draft.remove();
    root.lastElementChild.remove();
    root.style.width = "100%";
    const values = Array.from(root.querySelectorAll<HTMLSelectElement>("select")).map(select => ({id: select.id, value: select.value}));
    (window as unknown as {themePickerPreviews: unknown[]}).themePickerPreviews = [
        {name: "light", mode: "light", css: styles.base + styles.latte, html: root.outerHTML, values, frontend: "desktop", width: 960, height: 470},
        {name: "dark", mode: "dark", css: styles.base + styles.mocha, html: root.outerHTML, values, frontend: "desktop", width: 960, height: 470},
        {name: "mobile", mode: "light", css: styles.base + styles.mobile + styles.latte, html: root.outerHTML, values, frontend: "mobile", width: 390, height: 540},
    ];
    return "Theme previews, pairing, readonly and in-place settings updates passed";
};

test("theme preview and pairing preserve live settings, focus, readonly and mobile layouts", {timeout: 45000}, async () => {
    const sources = Object.fromEntries(Object.entries({palette: "./themePalette.ts", picker: "./themePicker.ts",
        settings: "./appearanceSettings.ts", escape: "../../util/escape.ts", compatibility: "../../util/themeCompatibility.ts",
        paths: "../util/dotPath.ts", save: "../setting/save.ts"}).map(([name, file]) => [name,
        transpileModule(readFileSync(path.resolve(__dirname, file), "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
    const styles: Record<string, string> = {};
    for (const entry of ["base", "mobile"]) {
        styles[entry] = sass.compile(path.resolve("src/assets/scss", entry + ".scss"), {logger: sass.Logger.silent}).css;
    }
    for (const [name, folder] of [["latte", "siyuan-catppuccin-latte"], ["mocha", "siyuan-catppuccin-mocha"]]) {
        styles[name] = readFileSync(path.resolve("appearance/themes", name === "latte" ? "daylight" : "midnight", "theme.css"), "utf8")
            .replace(/@import[^;]+;/g, "");
        // 候选主题必须覆盖基础主题，与实际的样式加载顺序一致。
        const theme = readFileSync(path.resolve("appearance/themes", folder, "theme.css"), "utf8").replace(/@import[^;]+;/g, "");
        styles[name] += theme;
    }
    const themes = Object.keys(themePalettes).map(name => {
        const meta = JSON.parse(readFileSync(path.resolve("appearance/themes", name, "theme.json"), "utf8"));
        return {name, label: (meta.displayName?.["zh-CN"] || meta.displayName?.default || name) + " (" + name + ")",
            modes: meta.modes, frontends: meta.frontends};
    });
    const lang = JSON.parse(readFileSync(path.resolve("appearance/langs/zh-CN.json"), "utf8"));
    const languages = Object.fromEntries(["theme", "appearance9", "theme11", "theme12", "themePairWithLight", "themePairWithDark"]
        .map(key => [key, lang[key]]));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-theme-picker-"));
    const script = path.join(temporary, "run.cjs");
    const preview = process.env.SIYUAN_UI_PREVIEW_DIR;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
const fs = require("node:fs"), path = require("node:path");
for (const key of ["home", "appData", "userData"]) {
    const directory = path.join(${JSON.stringify(temporary)}, key);
    fs.mkdirSync(directory, {recursive:true}); app.setPath(key, directory);
}
app.setAsDefaultProtocolClient = () => false;
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false,width:960,height:700,
        webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
    try {
        await win.loadURL("data:text/html,<html><head></head><body></body></html>");
        win.webContents.focus();
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)},${JSON.stringify(styles)},${JSON.stringify(themes)},${JSON.stringify(languages)})`)}));
        const output = ${JSON.stringify(preview)};
        if (output) {
            fs.mkdirSync(output, {recursive:true});
            const frames = await win.webContents.executeJavaScript("window.themePickerPreviews");
            for (const frame of frames) {
                win.setContentSize(frame.width, frame.height);
                await win.webContents.executeJavaScript('document.head.querySelector("style").textContent=' + JSON.stringify(frame.css) + ';document.body.innerHTML=' + JSON.stringify(frame.html) + ';document.documentElement.dataset.frontend=' + JSON.stringify(frame.frontend));
                await win.webContents.executeJavaScript('document.documentElement.dataset.themeMode=' + JSON.stringify(frame.mode) + ';' + JSON.stringify(frame.values) + '.forEach(item=>{document.getElementById(item.id).value=item.value})');
                await win.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                fs.writeFileSync(path.join(output, frame.name + ".png"), (await win.webContents.capturePage()).toPNG());
            }
        }
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 40000, windowsHide: true,
        });
        assert.match(result.stdout, /Theme previews, pairing, readonly and in-place settings updates passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
});
