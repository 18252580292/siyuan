const DOCUMENT_PATH = /^\/(?:\d{14}-[a-z0-9]{7}\/)*\d{14}-[a-z0-9]{7}\.sy$/;

const isPreordered = (paths: string[]) => {
    const closed = new Set<string>();
    let previous: string[] = [];
    for (const path of paths) {
        const stem = path === "/" ? path : path.slice(0, -3);
        const current = ["/"];
        for (let separator = stem.indexOf("/", 1); separator > 0; separator = stem.indexOf("/", separator + 1)) {
            current.push(stem.slice(0, separator));
        }
        if (stem !== "/") {
            current.push(stem);
        }
        let common = 0;
        while (common < previous.length && common < current.length && previous[common] === current[common]) {
            common++;
        }
        previous.slice(common).forEach(prefix => closed.add(prefix));
        if (current.some(prefix => closed.has(prefix))) {
            return false;
        }
        previous = current;
    }
    return true;
};

// 按原有顺序保留末端展开路径，规范文档路径只访问各自的祖先，兼容旧路径的前缀规则。
export const getLeafOpenPaths = (paths: string[]) => {
    if (!paths.every(path => path === "/" || DOCUMENT_PATH.test(path)) ||
        new Set(paths).size !== paths.length || !isPreordered(paths)) {
        const leaves = paths.slice();
        for (let i = 0; i < leaves.length; i++) {
            for (let j = i + 1; j < leaves.length; j++) {
                if (leaves[j].startsWith(leaves[i].replace(".sy", ""))) {
                    leaves.splice(i, 1);
                    j--;
                }
            }
        }
        return leaves;
    }
    const prefixes = new Set<string>();
    const leaves: string[] = [];
    for (let index = paths.length - 1; index >= 0; index--) {
        const path = paths[index];
        const stem = path === "/" ? path : path.slice(0, -3);
        if (!prefixes.has(stem)) {
            leaves.push(path);
        }
        prefixes.add(stem);
        let separator = stem.lastIndexOf("/");
        while (separator > 0) {
            prefixes.add(stem.slice(0, separator));
            separator = stem.lastIndexOf("/", separator - 1);
        }
        prefixes.add("/");
    }
    return leaves.reverse();
};

export const getNotebookOpenPaths = (notebook: Element): string[] => {
    const rows = new Map<string, Element>();
    const paths: string[] = [];
    notebook.querySelectorAll(".b3-list-item__arrow--open").forEach(arrow => {
        const row = arrow.closest("li");
        if (row) {
            const path = row.getAttribute("data-path");
            paths.push(path);
            if (!rows.has(path)) {
                rows.set(path, row);
            }
        }
    });
    return getLeafOpenPaths(paths).map(path =>
        rows.get(path)?.nextElementSibling?.firstElementChild?.getAttribute("data-path") || path);
};
