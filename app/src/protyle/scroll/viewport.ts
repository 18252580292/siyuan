interface IViewportBlock {
    id: string | null;
    top: number;
    bottom: number;
}

export const getVisibleRootBlockID = (blocks: IViewportBlock[], viewportTop: number, viewportBottom: number) => {
    return blocks.find((block) => block.id && block.bottom > viewportTop && block.top < viewportBottom)?.id;
};

const findVisibleLinearly = (blocks: Iterable<Element>, viewportTop: number, viewportBottom: number) => {
    for (const block of blocks) {
        const id = block.getAttribute("data-node-id");
        if (!id) {
            continue;
        }
        const rect = block.getBoundingClientRect();
        if (rect.bottom > viewportTop && rect.top < viewportBottom) {
            return id;
        }
    }
};

// 根块按文档流排列时二分定位；无布局盒的折叠块与非索引集合使用顺序查找。
export const getVisibleRootBlockIDFromElements = (blocks: Iterable<Element> & Partial<ArrayLike<Element>>,
                                                 viewportTop: number, viewportBottom: number) => {
    if (!blocks.length || blocks.length < 32) {
        return findVisibleLinearly(blocks, viewportTop, viewportBottom);
    }
    const parent = blocks[0]?.parentElement;
    const view = parent?.ownerDocument.defaultView;
    if (view) {
        const style = view.getComputedStyle(parent);
        if (!["block", "flow-root"].includes(style.display) || (style.columnCount !== "auto" && style.columnCount !== "1")) {
            return findVisibleLinearly(blocks, viewportTop, viewportBottom);
        }
    }
    const measured = new Map<number, {id: string, top: number, bottom: number}>();
    const measure = (index: number) => {
        if (!measured.has(index)) {
            const block = blocks[index];
            const id = block.getAttribute("data-node-id");
            const rect = id ? block.getBoundingClientRect() : undefined;
            measured.set(index, rect && rect.bottom > rect.top ? {id, top: rect.top, bottom: rect.bottom} : undefined);
        }
        return measured.get(index);
    };
    const first = measure(0);
    if (!first) {
        return findVisibleLinearly(blocks, viewportTop, viewportBottom);
    }
    if (first.bottom > viewportTop) {
        return first.top < viewportBottom ? first.id : undefined;
    }
    let left = 1;
    let right = blocks.length - 1;
    let found: ReturnType<typeof measure>;
    while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        const block = measure(middle);
        if (!block) {
            return findVisibleLinearly(blocks, viewportTop, viewportBottom);
        }
        if (block.bottom > viewportTop) {
            found = block;
            right = middle - 1;
        } else {
            left = middle + 1;
        }
    }
    return found && found.top < viewportBottom ? found.id : undefined;
};

export const isScrolledToBottom = (scrollTop: number, scrollHeight: number, clientHeight: number) => {
    return scrollHeight - scrollTop - clientHeight <= 1;
};
