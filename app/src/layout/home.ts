import type {App} from "../index";
import {fetchSyncPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {escapeAttr, escapeHtml} from "../util/escape";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {getFileTreeIconHTML} from "../emoji/fileTreeIcon";
import {Constants} from "../constants";
import {createHomeRequestPool, getHomeCoverURL, getHomeDetailsStatement, getHomeDocs, IHomeDoc, IHomeDocDetails} from "./homeData";

let requestHome = createHomeRequestPool();
const panelVersions = new WeakMap<HTMLElement, number>();
const homePanels = new WeakMap<Element, HTMLElement>();
const notebookStates = new Map<string, boolean>();

export const getHomeHTML = () => {
    const languages = window.siyuan.languages;
    const keys = window.siyuan.config.keymap.general;
    const actions = [
        {id: "editorEmptyFile", icon: "iconAddDoc", title: languages.newFile, key: keys.newFile.custom, writable: true},
        {id: "editorEmptySearch", icon: "iconSearch", title: languages.search, key: keys.globalSearch.custom},
        {id: "editorEmptyRecent", icon: "iconRecentDocs", title: languages.recentDocs, key: keys.recentDocs.custom},
        {id: "editorEmptyNewNotebook", icon: "iconNewNoteBook", title: languages.newNotebook, writable: true},
        {id: "editorEmptyHistory", icon: "iconHistory", title: languages.dataHistory, key: keys.dataHistory.custom, writable: true},
        {id: "editorEmptyHelp", icon: "iconHelp", title: languages.userGuide, writable: true},
    ];
    return `<div class="layout__empty layout__empty--home">
    <div class="layout__home">
        <div class="layout__home-hero">
        <div class="layout__home-header">
            <span class="layout__home-brand"><svg aria-hidden="true"><use xlink:href="#iconSiYuan"></use></svg>${escapeHtml(languages.siyuanNote)}</span>
            <h1>${languages.workspace}</h1>
        </div>
        <div class="layout__home-actions">${actions.slice(0, 3).filter(action => !action.writable || !window.siyuan.config.readonly).map(action =>
        `<button type="button" id="${action.id}" class="b3-button b3-button--tile">
            <svg><use xlink:href="#${action.icon}"></use></svg>
            <span>${action.title}</span>
            <span class="b3-button__shortcut">${updateHotkeyTip(action.key || "")}</span>
        </button>`).join("")}</div>
        </div>
        <div class="layout__home-body">
        <section class="layout__home-recent">
            <div class="layout__home-section-header"><h2>${languages.recentViewed}</h2>
                <button type="button" class="block__icon block__icon--show" data-home-refresh aria-label="${languages.refresh}"><svg><use xlink:href="#iconRefresh"></use></svg></button>
            </div>
            <div class="layout__home-status" role="status">${languages.loading}</div>
            <div class="b3-cards layout__home-documents"></div>
        </section>
        <div class="layout__home-links">${actions.slice(3).filter(action => !action.writable || !window.siyuan.config.readonly).map(action =>
        `<button type="button" id="${action.id}" class="b3-button b3-button--cancel b3-button--comfortable">
            <svg><use xlink:href="#${action.icon}"></use></svg><span>${action.title}</span>
        </button>`).join("")}</div>
        </div>
    </div>
</div>`;
};

const renderCards = (panel: HTMLElement, docs: IHomeDoc[], details = new Map<string, IHomeDocDetails>()) => {
    const locale = window.siyuan.config.appearance.lang;
    let date: Intl.DateTimeFormat;
    try {
        date = new Intl.DateTimeFormat(locale.replaceAll("_", "-"), {month: "short", day: "numeric"});
    } catch {
        date = new Intl.DateTimeFormat(undefined, {month: "short", day: "numeric"});
    }
    const focused = panel.contains(document.activeElement) ? document.activeElement.closest("[data-home-document]")?.getAttribute("data-home-document") : "";
    panel.querySelector(".layout__home-documents").innerHTML = docs.map(doc => {
        const detail = details.get(doc.rootID);
        const cover = getHomeCoverURL(detail?.cover);
        const viewedAt = doc.viewedAt > 0 ? date.format(new Date(doc.viewedAt * 1000)) : "";
        const updated = detail?.updated?.match(/^(\d{4})(\d{2})(\d{2})/);
        const stamp = updated ? date.format(new Date(+updated[1], +updated[2] - 1, +updated[3])) : viewedAt;
        const path = detail?.hpath?.split("/").slice(0, -1).filter(Boolean).join(" / ") || "";
        return `<button type="button" class="b3-card b3-card--document" data-home-document="${escapeAttr(doc.rootID)}">
            <span class="b3-card__thumbnail">${cover ? `<img class="b3-card__cover" src="${escapeAttr(cover)}" alt="" loading="lazy" decoding="async">` : getFileTreeIconHTML(doc.icon, "file", "b3-card__icon", true)}</span>
            <span class="b3-card__info b3-card__info--left">
                <span class="b3-card__title">${escapeHtml(doc.title || window.siyuan.languages.untitled)}</span>
                <span class="b3-card__desc">${escapeHtml(detail?.content || path)}</span>
                <span class="b3-card__meta"><span class="fn__ellipsis">${escapeHtml(path || window.siyuan.languages.recentViewed)}</span>
                    ${stamp ? `<span>${escapeHtml(updated ? window.siyuan.languages.updatedTime : window.siyuan.languages.recentViewed)} ${escapeHtml(stamp)}</span>` : ""}
                </span>
            </span>
        </button>`;
    }).join("");
    if (focused) {
        panel.querySelector<HTMLButtonElement>(`[data-home-document="${CSS.escape(focused)}"]`)?.focus({preventScroll: true});
    }
};

const loadHome = async (panel: HTMLElement) => {
    const version = (panelVersions.get(panel) || 0) + 1;
    panelVersions.set(panel, version);
    const current = () => panel.isConnected && panelVersions.get(panel) === version;
    const status = panel.querySelector<HTMLElement>(".layout__home-status");
    status.textContent = window.siyuan.languages.loading;
    status.classList.remove("fn__none");
    try {
        const response = await requestHome("recent", () => fetchSyncPost("/api/storage/getRecentDocs", {sortBy: "viewedAt"}, undefined, false));
        if (!current()) {
            return;
        }
        if (response.code !== 0) {
            panel.querySelector(".layout__home-documents").replaceChildren();
            status.textContent = window.siyuan.languages.refresh;
            return;
        }
        const docs = getHomeDocs(response.data);
        renderCards(panel, docs);
        status.textContent = window.siyuan.languages.empty;
        status.classList.toggle("fn__none", docs.length > 0);
        // 发布与只读界面仅展示已有的最近文档数据，不发起额外查询。
        if (!docs.length || window.siyuan.isPublish || window.siyuan.config.readonly) {
            return;
        }
        const closedNotebooks = new Set((window.siyuan.notebooks || []).filter(notebook => notebook.closed).map(notebook => notebook.id));
        notebookStates.forEach((closed, id) => {
            const notebook = window.siyuan.notebooks?.find(item => item.id === id);
            if (notebook && !!notebook.closed === closed) {
                notebookStates.delete(id);
            }
            if (closed) closedNotebooks.add(id);
            else closedNotebooks.delete(id);
        });
        const statement = getHomeDetailsStatement(docs, closedNotebooks);
        const metadata = await requestHome(statement, () => fetchSyncPost("/api/query/sql", {stmt: statement, mode: "readonly"}, undefined, false));
        if (!current() || metadata.code !== 0 || !Array.isArray(metadata.data)) {
            return;
        }
        const details = new Map<string, IHomeDocDetails>();
        metadata.data.forEach(item => {
            if (item && typeof item.id === "string") {
                const text = (key: string) => {
                    const value = item[key];
                    return typeof value === "string" ? value : "";
                };
                details.set(item.id, {id: item.id, content: text("content"), hpath: text("hpath"), updated: text("updated"), cover: text("cover")});
            }
        });
        renderCards(panel, docs, details);
    } catch {
        if (current()) {
            status.textContent = window.siyuan.languages.refresh;
        }
    }
};

export const initHomeRecentDocs = (app: App, panel: HTMLElement) => {
    const home = panel.querySelector(".layout__home");
    if (home) {
        homePanels.set(home, panel);
    }
    void loadHome(panel);
    panel.querySelector("[data-home-refresh]").addEventListener("click", () => { void loadHome(panel); });
    panel.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLButtonElement>("[data-home-document]");
        if (!target || !panel.contains(target)) {
            return;
        }
        openFileById({app, id: target.dataset.homeDocument, action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]});
        event.preventDefault();
        event.stopPropagation();
    });
};

// 关闭或移除笔记本时立即清空旧预览，刷新请求不复用关闭前的在途数据。
export const invalidateHomeRecentDocs = (notebookID?: string, closed = true) => {
    if (typeof notebookID === "string" && /^\d{14}-[a-z0-9]{7}$/.test(notebookID)) {
        notebookStates.set(notebookID, closed);
    }
    requestHome = createHomeRequestPool();
    document.querySelectorAll(".layout__home").forEach(home => {
        const panel = homePanels.get(home);
        if (!panel?.isConnected) {
            return;
        }
        panelVersions.set(panel, (panelVersions.get(panel) || 0) + 1);
        panel.querySelector(".layout__home-documents").replaceChildren();
        void loadHome(panel);
    });
};
