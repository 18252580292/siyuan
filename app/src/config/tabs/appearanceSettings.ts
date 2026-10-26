import {getAtPath} from "../util/dotPath";
import {syncThemePickers, syncThemeSelectOptions} from "./themePicker";

const confirmedValues = new WeakMap<HTMLElement, string>();
export const syncAppearanceSettings = () => {
    const appearance = window.siyuan.config.appearance;
    document.querySelectorAll<HTMLElement>("[data-appearance-settings]").forEach(root => {
        root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[id^="appearance."]').forEach(control => {
            if (control === document.activeElement) return;
            if (control.id === "appearance.themeLight" || control.id === "appearance.themeDark") return;
            if (control.id === "appearance.icon" && control instanceof HTMLSelectElement) {
                syncThemeSelectOptions(control, appearance.icons || []);
            }
            const value = control.id === "appearance.__themeMode" ? (appearance.modeOS ? 2 : appearance.mode) :
                getAtPath(appearance, control.id.slice("appearance.".length));
            const previous = confirmedValues.get(control);
            const localValue = control instanceof HTMLInputElement && control.type === "checkbox" ? String(control.checked) : control.value;
            if (previous !== undefined && previous === String(value) && localValue !== previous) return;
            if (control instanceof HTMLInputElement && control.type === "checkbox" && typeof value === "boolean") {
                control.checked = value;
            } else if (control instanceof HTMLSelectElement && ["string", "number"].includes(typeof value)) {
                control.value = String(value);
            }
            confirmedValues.set(control, String(value));
        });
        syncThemePickers(root, appearance);
    });
};

const mounted = new WeakSet<HTMLElement>();
export const mountAppearanceSettings = (root: HTMLElement) => {
    root.dataset.appearanceSettings = "";
    if (!mounted.has(root)) {
        mounted.add(root);
        root.addEventListener("focusout", () => {
            window.setTimeout(() => { if (root.isConnected) syncAppearanceSettings(); }, 0);
        });
    }
    syncAppearanceSettings();
};
