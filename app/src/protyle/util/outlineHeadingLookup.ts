// 每个事务按需查询标题；少量重复 ID 复用结果，批量查询切换为一次完整索引。
export const createOutlineHeadingLookup = (root: HTMLElement, operationCount = 0): Pick<Set<string>, "has"> => {
    const matches = new Map<string, boolean>();
    let headings: Set<string>;
    return {
        has(id: string) {
            if (headings) {
                return headings.has(id);
            }
            if (matches.has(id)) {
                return matches.get(id);
            }
            if (operationCount > 8 || matches.size >= 8 || id.includes("\u0000")) {
                headings = new Set(Array.from(root.querySelectorAll<HTMLElement>(
                    ".b3-list-item[data-node-id]"
                )).map(item => item.dataset.nodeId));
                return headings.has(id);
            }
            const found = !!root.querySelector(`.b3-list-item[data-node-id="${CSS.escape(id)}"]`);
            matches.set(id, found);
            return found;
        },
    };
};
