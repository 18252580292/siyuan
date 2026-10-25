const fs = require("fs");
const path = require("path");

const bundledThemeNames = ["siyuan-cream", "siyuan-forest", "siyuan-ocean", "siyuan-graphite",
    "siyuan-catppuccin-latte", "siyuan-catppuccin-mocha",
    "siyuan-pearl-bay", "siyuan-chihiro", "siyuan-violet-night", "siyuan-lemon-teal",
    "siyuan-pearl-bay-dark", "siyuan-chihiro-dark", "siyuan-violet-night-dark", "siyuan-lemon-teal-dark"];

// 将随应用提供的配色作为普通主题安装，保留已存在的同名包和用户修改。
const installBundledThemes = (resources, workspace) => {
    if (!workspace || !path.isAbsolute(workspace) || !fs.existsSync(workspace)) {
        return [];
    }
    const installed = [];
    const targetRoot = path.join(workspace, "data", "themes");
    for (const name of bundledThemeNames) {
        const source = path.join(resources, "appearance", "themes", name);
        const target = path.join(targetRoot, name);
        if (!fs.existsSync(source) || fs.existsSync(target)) {
            continue;
        }
        const metadata = JSON.parse(fs.readFileSync(path.join(source, "theme.json"), "utf8"));
        if (metadata.name !== name || !fs.existsSync(path.join(source, "theme.css"))) {
            throw new Error("Incomplete bundled theme: " + name);
        }
        fs.mkdirSync(targetRoot, {recursive: true});
        const temporary = fs.mkdtempSync(path.join(targetRoot, ".siyuan-theme-"));
        try {
            const files = ["theme.json", "theme.css"];
            if (fs.existsSync(path.join(source, "LICENSE"))) {
                files.push("LICENSE");
            }
            for (const file of files) {
                fs.copyFileSync(path.join(source, file), path.join(temporary, file));
            }
            fs.renameSync(temporary, target);
            installed.push(name);
        } finally {
            fs.rmSync(temporary, {recursive: true, force: true});
        }
    }
    return installed;
};

module.exports = {bundledThemeNames, installBundledThemes};
