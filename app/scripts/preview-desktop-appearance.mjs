import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import * as sass from "sass";

const app = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(app, "../../../validation/siyuan");
mkdirSync(output, {recursive: true});
// 只编译预览样式，不生成或覆盖应用的 webpack 产物。
const css = sass.compile(resolve(app, "src/assets/scss/base.scss"), {
    style: "expanded", quietDeps: true, logger: {warn() {}, debug() {}},
}).css.replaceAll("../../../appearance/", "/upstream/siyuan/app/appearance/");
writeFileSync(resolve(output, "desktop.css"), css);
writeFileSync(resolve(output, "index.html"), readFileSync(resolve(app, "tests/fixtures/desktopAppearance.html")));
console.log(output);
