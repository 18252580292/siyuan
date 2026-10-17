const FILE_TREE_RESTORE_CONCURRENCY = 6;

export const restoreFileTreePaths = async (
    filesPaths: {notebookId: string, openPaths: string[]}[],
    load: (notebookId: string, path: string) => Promise<void>,
) => {
    const levels: Map<string, {notebookId: string, path: string}>[] = [];
    filesPaths.forEach(({notebookId, openPaths}) => {
        openPaths.forEach(openPath => {
            const parts = openPath.split("/").filter(Boolean);
            // 保存的路径指向展开节点的子文档，只加载其祖先，保留目标文档的折叠状态。
            for (let depth = 0; depth < parts.length; depth++) {
                const path = depth === 0 ? "/" : `/${parts.slice(0, depth).join("/")}.sy`;
                levels[depth] = levels[depth] || new Map();
                levels[depth].set(JSON.stringify([notebookId, path]), {notebookId, path});
            }
        });
    });
    for (const level of levels) {
        // 每层限制并发数量，完成 DOM 插入后再加载下一层，避免刷新覆盖已展开的子树。
        const paths = level.values();
        await Promise.all(Array.from({length: Math.min(FILE_TREE_RESTORE_CONCURRENCY, level.size)}, async () => {
            for (const {notebookId, path} of paths) {
                try {
                    await load(notebookId, path);
                } catch (error) {
                    console.error(error);
                }
            }
        }));
    }
};
