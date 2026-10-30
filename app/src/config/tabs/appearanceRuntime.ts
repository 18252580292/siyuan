import {config as configApi} from "../util/configApi";
/// #if MOBILE
import {saveScroll} from "../../protyle/scroll/saveScroll";
/// #else
import {adjustDockPadding} from "../../layout/dock/util";
import {reloadUI as reloadDesktopUI} from "../../layout/util";
import {syncHideToolbarLayout, updateBarModeIcon} from "../../layout/topBar";
/// #endif
import {
    enqueueAppearanceUpdate,
    invalidateAppearancePackages,
    loadAssets,
    markAppearanceReloadPending,
    refreshHeadingNumberMeasurements,
    setBodyHighlight,
    setInlineStyle,
    unloadThemeScript
} from "../../util/assets";
import {getFrontend} from "../../util/functions";
import {getCurrentThemeName, isCurrentThemeSupported, shouldUnloadThemeScript} from "../../util/themeCompatibility";
import {remountOpenSettingTab} from "../setting/mount";
import {createConfigNamespaceApi} from "../util/namespaceApi";
import {createSectionRuntime} from "../util/sectionRuntime";
import {syncBodyGradient} from "./bodyGradient";
import {syncLockScreenWallpaper} from "./lockScreenWallpaper";
import {refreshDynamicIcons} from "../../emoji/dynamicIcon";
import {closeSettingsWindow, isSettingsWindow} from "../setting/windowContext";
import {syncAppearancePreferences} from "./appearancePreferences";
import {canSyncAppearanceSettings} from "./appearanceChanges";
import {syncAppearanceSettings} from "./appearanceSettings";

/** 主题模式下拉框初值：合并 mode / modeOS */
export const appearanceThemeModeValue = (): number =>
    window.siyuan.config.appearance.modeOS ? 2 : window.siyuan.config.appearance.mode;

/** 主题模式选择：合并 mode / modeOS 后提交 */
export const saveThemeMode = (value: number) => {
    const OSThemeMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? 1 : 0;
    configApi.set("appearance", {
        mode: (value === 2 ? OSThemeMode : value) as Config.IAppearance["mode"],
        modeOS: value === 2,
    });
};

/// #if MOBILE
const reloadUI = async () => {
    if (window.siyuan.mobile.editor) {
        await saveScroll(window.siyuan.mobile.editor.protyle);
    }
    window.location.reload();
};
/// #endif

interface IAppearanceRefresh {
    appearance: Config.IAppearance;
    themes: string[] | null;
    icons: string[] | null;
    revision: string;
}

const applyAppearanceBars = (old: Config.IAppearance, next: Config.IAppearance) => {
    document.getElementById("status")?.classList.toggle("fn__none", next.hideStatusBar);
    /// #if !MOBILE
    if (!isSettingsWindow() && next.hideStatusBar !== old.hideStatusBar) adjustDockPadding();
    if (!isSettingsWindow() && next.hideToolbar !== old.hideToolbar) syncHideToolbarLayout();
    if (!isSettingsWindow() && (next.mode !== old.mode || next.modeOS !== old.modeOS)) updateBarModeIcon();
    /// #endif
};

const applyAppearanceConfig = async (data: Config.IAppearance, refresh?: IAppearanceRefresh) => {
    if (data.lang !== window.siyuan.config.appearance.lang) {
        if (isSettingsWindow()) {
            closeSettingsWindow();
            return;
        }
        markAppearanceReloadPending();
        /// #if MOBILE
        void reloadUI();
        /// #else
        void reloadDesktopUI();
        /// #endif
        return;
    }

    const prevAppearance = window.siyuan.config.appearance;
    const changedPackages = refresh && invalidateAppearancePackages(refresh.themes || [], refresh.icons || [], refresh.revision);
    const themeChanged = changedPackages?.themes.some(name => name === getCurrentThemeName(prevAppearance) ||
        name === getCurrentThemeName(data));
    // 独立控件与主题包列表原位同步，只有当前外观资源发生变化才重新加载。
    // 启动初始化传入当前配置本身，需要完整加载外观资源；重复推送仍使用原位同步。
    const localUpdate = prevAppearance !== data && canSyncAppearanceSettings(prevAppearance, data);
    const assetKeys: Array<keyof Config.IAppearance> = ["mode", "modeOS", "themeVer", "themeJS", "icon", "iconVer",
        "codeBlockThemeLight", "codeBlockThemeDark"];
    const assetsChanged = !localUpdate || themeChanged || changedPackages?.icons.includes(data.icon) ||
        getCurrentThemeName(prevAppearance) !== getCurrentThemeName(data) ||
        isCurrentThemeSupported(prevAppearance, getFrontend()) !== isCurrentThemeSupported(data, getFrontend()) ||
        assetKeys.some(key => JSON.stringify(prevAppearance[key]) !== JSON.stringify(data[key]));
    if (!assetsChanged) {
        window.siyuan.config.appearance = data;
        syncAppearancePreferences();
        if (JSON.stringify(prevAppearance.lockScreenWallpaper) !== JSON.stringify(data.lockScreenWallpaper)) syncLockScreenWallpaper();
        applyAppearanceBars(prevAppearance, data);
        setBodyHighlight(data.bodyGradient);
        syncBodyGradient();
        syncAppearanceSettings();
        return;
    }
    const unloadChangedTheme = themeChanged && prevAppearance.themeJS && isCurrentThemeSupported(prevAppearance, getFrontend());
    if ((unloadChangedTheme || shouldUnloadThemeScript(prevAppearance, data, getFrontend())) && !await unloadThemeScript()) {
        if (closeSettingsWindow()) return;
        markAppearanceReloadPending();
        /// #if MOBILE
        void reloadUI();
        /// #else
        void reloadDesktopUI();
        /// #endif
        return;
    }

    await createSectionRuntime<Config.IAppearance>({
        namespace: "appearance",
        get: () => prevAppearance,
        set: next => { window.siyuan.config.appearance = next; },
        reactions: [{
            name: "preferences",
            changed: () => true,
            apply: () => { syncAppearancePreferences(); },
        }, {
            name: "lock-screen-wallpaper",
            changed: (old, next) => old.lockScreenWallpaper !== next.lockScreenWallpaper,
            apply: () => { syncLockScreenWallpaper(); },
        }, {
            name: "gradient",
            changed: () => !assetsChanged,
            apply: () => {
                setBodyHighlight(data.bodyGradient);
                syncBodyGradient();
            },
        }, {
            name: "bars",
            changed: () => true,
            apply: applyAppearanceBars,
        }, {
            name: "appearance-resources",
            changed: () => assetsChanged,
            apply: async (old, next) => {
                await loadAssets(next);
                if (JSON.stringify(next.globalFontFamilies) !== JSON.stringify(old.globalFontFamilies)) {
                    await setInlineStyle();
                    refreshHeadingNumberMeasurements();
                    refreshDynamicIcons();
                }
                if (localUpdate) {
                    syncBodyGradient();
                    syncAppearanceSettings();
                    return;
                }
                /// #if !MOBILE
                void remountOpenSettingTab("appearance");
                /// #endif
            },
        }],
    }).apply(data);
};

export const refreshAppearance = (data: IAppearanceRefresh) =>
    enqueueAppearanceUpdate(() => applyAppearanceConfig(data.appearance, data));

/** 外观 Tab 命名空间：设置面板注册项 save */
export const appearanceConfigApi = createConfigNamespaceApi<Config.IAppearance>({
    namespace: "appearance",
    getConfig: () => window.siyuan.config.appearance,
    setConfig: data => enqueueAppearanceUpdate(() => applyAppearanceConfig(data)),

});
