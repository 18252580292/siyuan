const localKeys = new Set([
    "compactMode", "menuMouseScroll", "pdfTheme", "outlineKeepCurrentExpand", "mobileBars",
    "bodyGradient", "mode", "modeOS", "themeLight", "themeDark", "themeVer", "themeJS", "lightThemes", "darkThemes",
    "icon", "iconVer", "icons", "codeBlockThemeLight", "codeBlockThemeDark", "hideToolbar", "hideStatusBar", "closeButtonBehavior",
]);

// 只更新独立控件的外观字段；字体列表、详情草稿和依赖关系复杂的设置继续走受保护的重建流程。
export const canSyncAppearanceSettings = (previous: Config.IAppearance, next: Config.IAppearance) =>
    Object.keys({...previous, ...next}).every(key => localKeys.has(key) ||
        JSON.stringify(previous[key as keyof Config.IAppearance]) === JSON.stringify(next[key as keyof Config.IAppearance]));
