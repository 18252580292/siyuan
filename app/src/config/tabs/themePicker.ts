import {escapeAttr, escapeHtml} from "../../util/escape";
import {getFrontend} from "../../util/functions";
import {isThemeFrontendSupported} from "../../util/themeCompatibility";
import {getPairedThemeName, getThemeDisplayName, getThemePalette} from "./themePalette";

type ThemeMode = "light" | "dark";
const confirmedSelections = new WeakMap<HTMLSelectElement, string>();

export const getAppearanceThemeChoices = (mode: ThemeMode, appearance = window.siyuan.config.appearance) =>
    (mode === "light" ? appearance.lightThemes : appearance.darkThemes)
        .filter(item => isThemeFrontendSupported(item.frontends, getFrontend()));

const previewHTML = (name: string) => {
    const palette = getThemePalette(name);
    if (!palette) return "";
    return `<span class="config-theme-preview" aria-hidden="true" style="--preview-background:${palette.background};--preview-surface:${palette.surface};--preview-text:${palette.text};--preview-accent:${palette.accent}">
        <span class="config-theme-preview__sidebar"><i></i><i></i><i></i></span>
        <span class="config-theme-preview__page"><b>Aa</b><i></i><i></i><i></i></span>
    </span>`;
};

export const syncThemeSelectOptions = (select: HTMLSelectElement, items: {name: string; label: string}[]) => {
    const labels = items.map(item => ({name: item.name, label: getThemeDisplayName(item)}));
    if (select.options.length === labels.length && labels.every((item, index) =>
        select.options[index].value === item.name && select.options[index].textContent === item.label)) return;
    const selected = select.value;
    select.replaceChildren(...labels.map(item => new Option(item.label, item.name)));
    select.value = selected;
};

const updatePicker = (root: HTMLElement, mode: ThemeMode, appearance: Config.IAppearance) => {
    const row = root.querySelector<HTMLElement>(`[data-theme-picker="${mode}"]`);
    if (!row) return;
    const select = row.querySelector<HTMLSelectElement>("select");
    select.disabled = window.siyuan.config.readonly;
    select.title = select.value;
    const preview = row.querySelector<HTMLElement>("[data-theme-preview]");
    if (preview.dataset.themeName !== select.value) {
        preview.innerHTML = previewHTML(select.value);
        preview.dataset.themeName = select.value;
    }
    preview.hidden = !getThemePalette(select.value);
    const opposite = mode === "light" ? "dark" : "light";
    const oppositeSelect = root.querySelector<HTMLSelectElement>(`[data-theme-picker="${opposite}"] select`);
    const counterpart = getPairedThemeName(oppositeSelect?.value || "", getAppearanceThemeChoices(mode, appearance));
    const button = row.querySelector<HTMLButtonElement>("[data-theme-pair]");
    button.hidden = !counterpart;
    button.disabled = window.siyuan.config.readonly || !counterpart || counterpart === select.value;
    button.dataset.themePair = counterpart || "";
};

export const syncThemePickers = (root: HTMLElement, appearance = window.siyuan.config.appearance) => {
    for (const mode of ["light", "dark"] as const) {
        const select = root.querySelector<HTMLSelectElement>(`[data-theme-picker="${mode}"] select`);
        if (!select) continue;
        // 原生菜单展开期间保留选项节点；旧确认值不得覆盖尚未收到响应的本地选择。
        if (select !== document.activeElement) {
            const selected = mode === "light" ? appearance.themeLight : appearance.themeDark;
            const previous = confirmedSelections.get(select);
            const editing = previous !== undefined && selected === previous && select.value !== previous;
            syncThemeSelectOptions(select, getAppearanceThemeChoices(mode, appearance));
            if (!editing) select.value = selected;
            confirmedSelections.set(select, selected);
        }
    }
    updatePicker(root, "light", appearance);
    updatePicker(root, "dark", appearance);
};

export const genThemePickerHTML = (openFolder = false) => {
    const appearance = window.siyuan.config.appearance;
    const lang = window.siyuan.languages;
    return `<div class="b3-label config-item" data-appearance-theme-picker>
        <div class="config-theme-heading"><div class="config-name">${lang.theme}</div>
        ${openFolder ? `<button type="button" class="b3-button b3-button--outline" id="appearanceOpenTheme">${lang.appearance9}</button>` : ""}</div>
        ${(["light", "dark"] as const).map(mode => {
        const name = mode === "light" ? appearance.themeLight : appearance.themeDark;
        const description = mode === "light" ? lang.theme11 : lang.theme12;
        return `<div class="config-theme-picker" data-theme-picker="${mode}">
            <span data-theme-preview data-theme-name="${escapeAttr(name)}"${getThemePalette(name) ? "" : " hidden"}>${previewHTML(name)}</span>
            <div class="config-theme-picker__controls">
                <label class="b3-label__text" for="appearance.theme${mode === "light" ? "Light" : "Dark"}">${description}</label>
                <select class="b3-select" id="appearance.theme${mode === "light" ? "Light" : "Dark"}"${window.siyuan.config.readonly ? " disabled" : ""}>
                    ${getAppearanceThemeChoices(mode).map(item => `<option value="${escapeAttr(item.name)}"${item.name === name ? " selected" : ""}>${escapeHtml(getThemeDisplayName(item))}</option>`).join("")}
                </select>
                <button type="button" class="b3-button b3-button--cancel b3-button--small" data-theme-pair hidden>${mode === "light" ? lang.themePairWithDark : lang.themePairWithLight}</button>
            </div>
        </div>`;
    }).join("")}</div>`;
};

const mounted = new WeakSet<HTMLElement>();
export const mountThemePickers = (root: HTMLElement) => {
    const picker = root.querySelector<HTMLElement>("[data-appearance-theme-picker]");
    if (!picker || mounted.has(picker)) return;
    mounted.add(picker);
    picker.addEventListener("change", () => {
        updatePicker(root, "light", window.siyuan.config.appearance);
        updatePicker(root, "dark", window.siyuan.config.appearance);
    });
    picker.addEventListener("click", event => {
        const button = (event.target as Element).closest<HTMLButtonElement>("[data-theme-pair]");
        if (!button || button.disabled || window.siyuan.config.readonly || !button.dataset.themePair) return;
        const select = button.closest("[data-theme-picker]").querySelector<HTMLSelectElement>("select");
        select.value = button.dataset.themePair;
        select.dispatchEvent(new Event("change", {bubbles: true}));
    });
    syncThemePickers(root);
};
