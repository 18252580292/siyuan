import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, luteSource: string, renameSource: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    const config = {editor: {displayImgName: true, displayImgAlt: true}, readonly: false};
    Object.assign(window, {siyuan: {config, languages: {rename: "Rename", renameAssetTip: "Updates all links"}}});
    const renamed: {path: string, name: string}[] = [];
    const getExtension = (value: string) => require("node:path").posix.extname(value.split("?")[0]);
    const dependencies = {
        getAssetExtension: getExtension,
        getAssetName: (value: string) => require("node:path").posix.basename(value.split("?")[0], getExtension(value))
            .replace(/-\d{14}-\w{7}$/, ""),
        isEncryptedBox: (box: string) => box === "encrypted",
    };
    let options: {value: string, description: string, onConfirm: (value: string, dialog: {destroy: () => void}) => Promise<void>};
    let opens = 0;
    let closes = 0;
    const dialog = {element: document.createElement("div"), destroy: () => closes++};
    const renameAsset = new Function("getAssetName", "openInputDialog", "Constants", "fetchSyncPost", "getAllModels", "getAllEditor",
        renameSource + "\nreturn renameAsset;")(dependencies.getAssetName,
        (value: typeof options) => { options = value; opens++; return dialog; }, {},
        async (_url: string, body: {oldPath: string, newName: string}) => {
            renamed.push({path: body.oldPath, name: body.newName});
            return {code: 0, data: {newPath: "assets/renamed.png"}};
        }, (): {asset: {path: string}[]} => ({asset: []}), (): {reload: (value: boolean) => void}[] => []);
    const displayAPI = new Function(...Object.keys(dependencies), "renameAsset", source +
        "\nreturn {render:renderImageDisplay, dimensions:imageDimensions};")(...Object.values(dependencies), renameAsset);
    const render = displayAPI.render;
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.innerHTML = lute.Md2BlockDOM('![description](assets/example-20260930090000-abcdefg.png "caption")');
    document.body.append(root);
    const original = lute.BlockDOM2StdMd(root.innerHTML);
    render(root);
    render(root);
    check.equal(root.querySelectorAll(".img__name").length, 1);
    const name = root.querySelector<HTMLElement>(".img__name");
    check.equal(name.textContent, "example.png");
    const alt = root.querySelector<HTMLElement>(".img__alt");
    check.equal(alt.textContent, "description");
    check.equal(alt.previousElementSibling.className, "protyle-action__title");
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
    const image = root.querySelector("img");
    check.equal(image.hasAttribute("title"), false, "native tooltips are disabled without discarding the title");
    check.equal(image.getAttribute("data-title"), "caption");
    name.click();
    check.equal(name.querySelector("input"), null);
    check.equal(options.value, "example");
    check.equal(options.description, "Updates all links");
    check.equal(renamed.length, 0);
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
    await options.onConfirm("renamed", dialog);
    check.deepEqual(renamed, [{path: "assets/example-20260930090000-abcdefg.png", name: "renamed"}]);
    name.click();
    dialog.destroy();
    check.equal(name.querySelector("input"), null);
    check.equal(renamed.length, 1);
    check.equal(closes, 2);
    check.equal(opens, 2);
    root.setAttribute("data-readonly", "true");
    name.click();
    check.equal(name.querySelector("input"), null);
    check.equal(opens, 2);
    root.setAttribute("data-readonly", "false");
    root.setAttribute("data-notebook-id", "encrypted");
    name.click();
    check.equal(name.querySelector("input"), null);
    check.equal(opens, 2);
    config.editor.displayImgName = false;
    config.editor.displayImgAlt = false;
    render(root);
    check.equal(root.querySelector(".img__name"), null);
    check.equal(root.querySelector(".img__alt"), null);
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
    config.editor.displayImgName = true;
    root.removeAttribute("data-notebook-id");
    render(root);
    const snapshot = root.innerHTML;
    root.innerHTML = snapshot;
    render(root);
    const restoredName = root.querySelector<HTMLElement>(".img__name");
    restoredName.click();
    check.equal(opens, 3, "restored image names open the rename dialog");
    check.equal(restoredName.querySelector("input"), null);
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    config.editor.displayImgAlt = false;
    config.editor.displayImgName = false;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 240;
    const data = URL.createObjectURL(await new Promise<Blob>(resolve => canvas.toBlob(resolve)));
    root.innerHTML = lute.Md2BlockDOM("![layout](assets/layout.png)");
    const firstImage = root.querySelector("img");
    firstImage.src = data;
    await firstImage.decode();
    render(root);
    check.equal(firstImage.getAttribute("data-ui-image-width"), "480px");
    const loadedHeight = firstImage.getBoundingClientRect().height;
    check.ok(loadedHeight > 0);
    root.innerHTML = lute.Md2BlockDOM("![layout](assets/layout.png)");
    const secondImage = root.querySelector("img");
    secondImage.src = data;
    const sourceBeforeLayout = lute.BlockDOM2StdMd(root.innerHTML);
    render(root);
    check.ok(Math.abs(secondImage.getBoundingClientRect().height - loadedHeight) < 1,
        "a pending image reserves the dimensions learned from its previous successful load");
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), sourceBeforeLayout, "layout cache attributes do not enter Markdown");
    secondImage.src = data;
    await secondImage.decode();
    check.ok(Math.abs(secondImage.getBoundingClientRect().height - loadedHeight) < 1);
    secondImage.style.width = "120px";
    secondImage.style.height = "75px";
    render(root);
    check.equal(secondImage.getBoundingClientRect().width, 120, "explicit image sizing wins over cached geometry");
    check.equal(secondImage.getBoundingClientRect().height, 75);
    secondImage.removeAttribute("style");
    secondImage.parentElement.style.width = "160px";
    render(root);
    check.equal(secondImage.getBoundingClientRect().width, 160, "drag-resized image containers keep their width");
    check.ok(Math.abs(secondImage.getBoundingClientRect().height - 80) < 1);
    for (let i = 0; i < 260; i++) {
        secondImage.src = data + "#" + i;
        await secondImage.decode();
        render(root);
    }
    check.equal(displayAPI.dimensions.size, 256, "image geometry cache has a fixed entry budget");
    secondImage.src = data + "#" + "x".repeat(4097);
    await secondImage.decode();
    render(root);
    check.equal(secondImage.hasAttribute("data-ui-image-width"), false, "large embedded URLs do not remain in the cache");
    check.ok([...displayAPI.dimensions.keys()].every((key: string) => key.length <= 4096));
    URL.revokeObjectURL(data);
    return "Image display cases passed";
};

test("image names open a rename dialog that updates references only after confirmation", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = ["imageTitle.ts", "imageDisplay.ts"].map(file => transpileModule(readFileSync(path.resolve(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
    const luteSource = readFileSync("stage/protyle/js/lute/lute.min.js", "utf8");
    const renameSource = transpileModule(readFileSync(path.resolve(__dirname, "../../editor/rename.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-image-display-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" +
        JSON.stringify(source) + "," + JSON.stringify(luteSource) + "," + JSON.stringify(renameSource) + "," +
        JSON.stringify(require("sass").compile("src/assets/scss/component/_typography.scss", {logger: require("sass").Logger.silent}).css) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
for (const name of ["home", "appData"]) {
    const folder = require("node:path").join(${JSON.stringify(temporary)}, name);
    require("node:fs").mkdirSync(folder, {recursive:true});
    app.setPath(name, folder);
}
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.setAsDefaultProtocolClient = () => false;
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Image display cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-image-display-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
