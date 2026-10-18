const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {bundledThemeNames, installBundledThemes} = require("./bundledThemes");

test("bundled themes install complete packages without replacing existing custom themes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-themes-test-"));
    try {
        const workspace = path.join(root, "workspace");
        const themes = path.join(workspace, "data", "themes");
        const resources = path.join(__dirname, "..");
        fs.mkdirSync(path.join(themes, bundledThemeNames[0]), {recursive: true});
        fs.writeFileSync(path.join(themes, bundledThemeNames[0], "theme.css"), "user-edited theme");
        assert.deepEqual(installBundledThemes(resources, workspace), bundledThemeNames.slice(1));
        assert.equal(fs.readFileSync(path.join(themes, bundledThemeNames[0], "theme.css"), "utf8"), "user-edited theme");
        for (const name of bundledThemeNames.slice(1)) {
            assert.equal(JSON.parse(fs.readFileSync(path.join(themes, name, "theme.json"), "utf8")).name, name);
            assert.equal(fs.readFileSync(path.join(themes, name, "theme.css"), "utf8"),
                fs.readFileSync(path.join(resources, "appearance", "themes", name, "theme.css"), "utf8"));
            const license = path.join(resources, "appearance", "themes", name, "LICENSE");
            if (fs.existsSync(license)) {
                assert.equal(fs.readFileSync(path.join(themes, name, "LICENSE"), "utf8"),
                    fs.readFileSync(license, "utf8"));
            }
        }
        assert.deepEqual(installBundledThemes(resources, workspace), []);
        assert.deepEqual(fs.readdirSync(themes).sort(), [...bundledThemeNames].sort());
        assert.deepEqual(installBundledThemes(resources, "relative-workspace"), []);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test("incomplete bundled themes leave no partial package in the workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-themes-test-"));
    try {
        const workspace = path.join(root, "workspace");
        const resources = path.join(root, "resources");
        const source = path.join(resources, "appearance", "themes", bundledThemeNames[0]);
        fs.mkdirSync(workspace);
        fs.mkdirSync(source, {recursive: true});
        fs.writeFileSync(path.join(source, "theme.json"), JSON.stringify({name: bundledThemeNames[0]}));
        assert.throws(() => installBundledThemes(resources, workspace), /Incomplete bundled theme/);
        assert.equal(fs.existsSync(path.join(workspace, "data", "themes", bundledThemeNames[0])), false);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});
