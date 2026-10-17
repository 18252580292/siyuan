// 仅更新变化的文档行并移动顺序变化的节点，复用未变化的行和展开子列表。
export const refreshFileTreeChildren = (list: Element, html: string, selected: Element = null): Element => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const freshRows = Array.from(template.content.children);
    return reconcileFileTreeRows(list, freshRows, selected);
};

const rowStates = new WeakMap<Element, {context: string, rows: Map<string, {key: string, element: Element}>}>();

// 顺序稳定的列表直接处理变化行，避免为未变化的目录重建映射并重复协调 DOM。
const refreshStableFileTreeRows = <T extends {id: string}>(list: Element, files: T[], context: string,
                                                          render: (file: T) => string, selected: Element) => {
    const previous = rowStates.get(list);
    if (!previous || previous.context !== context || previous.rows.size !== files.length) {
        return;
    }
    const changed: {file: T, key: string, element: Element}[] = [];
    let cursor = list.firstElementChild;
    for (const file of files) {
        const cached = previous.rows.get(file.id);
        if (!cached || cached.element !== cursor || cached.element.getAttribute("data-node-id") !== file.id) {
            return;
        }
        const key = JSON.stringify(file);
        if (key !== cached.key) {
            changed.push({file, key, element: cached.element});
        }
        cursor = cursor.nextElementSibling;
        if (cursor?.tagName === "UL") {
            if (!cached.element.querySelector(".b3-list-item__arrow--open")) {
                return;
            }
            cursor = cursor.nextElementSibling;
        }
    }
    if (cursor) {
        return;
    }
    if (changed.length) {
        const template = document.createElement("template");
        template.innerHTML = changed.map(item => render(item.file)).join("");
        const freshRows = Array.from(template.content.children);
        if (freshRows.length !== changed.length || freshRows.some((row, index) =>
            row.getAttribute("data-node-id") !== changed[index].file.id)) {
            return;
        }
        changed.forEach((item, index) => {
            const fresh = freshRows[index];
            if (item.element.classList.contains("b3-list-item--focus")) {
                fresh.classList.add("b3-list-item--focus");
            }
            if (item.element.nextElementSibling?.tagName === "UL") {
                fresh.querySelector(".b3-list-item__arrow")?.classList.add("b3-list-item__arrow--open");
            }
            let mounted = item.element;
            if (!item.element.isEqualNode(fresh)) {
                list.insertBefore(fresh, item.element);
                item.element.remove();
                mounted = fresh;
                if (selected === item.element) {
                    selected = fresh;
                }
            }
            previous.rows.set(item.file.id, {key: item.key, element: mounted});
        });
    }
    return {selected};
};

// 每个已挂载列表仅保存当前行的数据签名，未变化的行无需生成或解析 HTML。
export const refreshFileTreeRows = <T extends {id: string}>(list: Element, files: T[], context: string,
                                                          render: (file: T) => string, selected: Element = null) => {
    const stable = refreshStableFileTreeRows(list, files, context, render, selected);
    if (stable) {
        return stable.selected;
    }
    const previous = rowStates.get(list);
    const keys = new Map<string, string>();
    const rows = new Map<string, Element>();
    const changed: string[] = [];
    files.forEach(file => {
        const key = JSON.stringify(file);
        keys.set(file.id, key);
        const cached = previous?.rows.get(file.id);
        if (previous?.context === context && cached?.key === key && cached.element.parentElement === list &&
            cached.element.getAttribute("data-node-id") === file.id) {
            rows.set(file.id, cached.element);
        } else {
            changed.push(render(file));
        }
    });
    if (changed.length) {
        const template = document.createElement("template");
        template.innerHTML = changed.join("");
        Array.from(template.content.children).forEach(row => rows.set(row.getAttribute("data-node-id"), row));
    }
    const selection = reconcileFileTreeRows(list, files.map(file => rows.get(file.id)), selected);
    const currentRows = new Map<string, {key: string, element: Element}>();
    // 协调过程可能复用与新 HTML 相等的原节点，记录最终挂载的节点。
    Array.from(list.children).forEach(row => {
        const id = row.getAttribute("data-node-id");
        if (keys.has(id)) {
            currentRows.set(id, {key: keys.get(id), element: row});
        }
    });
    rowStates.set(list, {context, rows: currentRows});
    return selection;
};

const reconcileFileTreeRows = (list: Element, freshRows: Element[], selected: Element) => {
    const selectedID = selected && list.contains(selected) ? selected.getAttribute("data-node-id") : null;
    const rows = new Map<string, Element>();
    freshRows.forEach(row => {
        const id = row.getAttribute("data-node-id");
        if (id) {
            rows.set(id, row);
        }
    });
    const subtrees = new Map<string, Element>();
    Array.from(list.children).forEach(row => {
        const replacement = rows.get(row.getAttribute("data-node-id"));
        if (!replacement) {
            return;
        }
        if (row !== replacement && row.classList.contains("b3-list-item--focus")) {
            replacement.classList.add("b3-list-item--focus");
        }
        const children = row.nextElementSibling;
        if (children?.tagName === "UL" && row.querySelector(".b3-list-item__arrow--open")) {
            subtrees.set(row.getAttribute("data-node-id"), children);
            if (row !== replacement) {
                replacement.querySelector(".b3-list-item__arrow")?.classList.add("b3-list-item__arrow--open");
            }
        }
        if (row === replacement || row.isEqualNode(replacement)) {
            rows.set(row.getAttribute("data-node-id"), row);
        }
    });
    const nextChildren: Element[] = [];
    freshRows.forEach(fresh => {
        const id = fresh.getAttribute("data-node-id");
        nextChildren.push(rows.get(id) || fresh);
        if (subtrees.has(id)) {
            nextChildren.push(subtrees.get(id));
        }
    });
    const retained = new Set(nextChildren);
    Array.from(list.children).forEach(node => {
        if (!retained.has(node)) {
            node.remove();
        }
    });
    let cursor = list.firstElementChild;
    nextChildren.forEach(node => {
        if (node === cursor) {
            cursor = cursor.nextElementSibling;
        } else {
            list.insertBefore(node, cursor);
        }
    });
    if (!selectedID || list.contains(selected)) {
        return selected;
    }
    return rows.get(selectedID) || null;
};
