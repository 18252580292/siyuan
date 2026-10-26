export interface IThemePalette {
    background: string;
    surface: string;
    text: string;
    accent: string;
}

// 内置主题的小色板不加载主题脚本和外部资源，第三方主题继续使用原生选择框。
export const themePalettes: Record<string, IThemePalette> = {
    "daylight": {
        "background": "#ffffff",
        "surface": "#f3f4f6",
        "text": "#292c33",
        "accent": "#7055c4"
    },
    "midnight": {
        "background": "#252629",
        "surface": "#1e1f22",
        "text": "#e8e9ed",
        "accent": "#c2adf5"
    },
    "siyuan-catppuccin-latte": {
        "background": "#eff1f5",
        "surface": "#e6e9ef",
        "text": "#4c4f69",
        "accent": "#8839ef"
    },
    "siyuan-catppuccin-mocha": {
        "background": "#1e1e2e",
        "surface": "#181825",
        "text": "#cdd6f4",
        "accent": "#cba6f7"
    },
    "siyuan-chihiro": {
        "background": "#f5f1ee",
        "surface": "#eae5e1",
        "text": "#434c61",
        "accent": "#1e2f5a"
    },
    "siyuan-chihiro-dark": {
        "background": "#242631",
        "surface": "#1c1f28",
        "text": "#d8dce6",
        "accent": "#eeb18c"
    },
    "siyuan-cream": {
        "background": "#fffcf5",
        "surface": "#f3eee3",
        "text": "#373229",
        "accent": "#845c2d"
    },
    "siyuan-forest": {
        "background": "#fbfdfb",
        "surface": "#ebf1ed",
        "text": "#253c31",
        "accent": "#2d654b"
    },
    "siyuan-graphite": {
        "background": "#25272a",
        "surface": "#1e2023",
        "text": "#e7e7e8",
        "accent": "#bac2cf"
    },
    "siyuan-lemon-teal": {
        "background": "#f5f4ec",
        "surface": "#e9e9df",
        "text": "#405451",
        "accent": "#185a56"
    },
    "siyuan-lemon-teal-dark": {
        "background": "#222927",
        "surface": "#1a211f",
        "text": "#d8e0dc",
        "accent": "#ded8a1"
    },
    "siyuan-ocean": {
        "background": "#1c2838",
        "surface": "#162131",
        "text": "#e5edf7",
        "accent": "#90bdec"
    },
    "siyuan-pearl-bay": {
        "background": "#f5f2e9",
        "surface": "#eae8df",
        "text": "#354b47",
        "accent": "#006e63"
    },
    "siyuan-pearl-bay-dark": {
        "background": "#222826",
        "surface": "#1b211f",
        "text": "#d9dfd9",
        "accent": "#9acabd"
    },
    "siyuan-violet-night": {
        "background": "#f2f0f7",
        "surface": "#e7e4ef",
        "text": "#48485f",
        "accent": "#030921"
    },
    "siyuan-violet-night-dark": {
        "background": "#252430",
        "surface": "#1d1c27",
        "text": "#dcd9e6",
        "accent": "#c6adec"
    }
};

export const getThemePalette = (name: string) => Object.prototype.hasOwnProperty.call(themePalettes, name) ? themePalettes[name] : undefined;

const themePairs = [
    ["daylight", "midnight"],
    ["siyuan-catppuccin-latte", "siyuan-catppuccin-mocha"],
    ...["pearl-bay", "chihiro", "violet-night", "lemon-teal"].map(name => ["siyuan-" + name, "siyuan-" + name + "-dark"]),
];

export const getPairedThemeName = (name: string, available: readonly {name: string}[]) => {
    const pair = themePairs.find(items => items.includes(name));
    const other = pair?.find(item => item !== name);
    return other && available.some(item => item.name === other) ? other : undefined;
};

export const getThemeDisplayName = (theme: {name: string; label: string}) => {
    const suffix = " (" + theme.name + ")";
    return theme.label.endsWith(suffix) ? theme.label.slice(0, -suffix.length) : theme.label;
};
