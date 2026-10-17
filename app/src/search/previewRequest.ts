interface IPreviewTask {
    controller: AbortController;
    cleanups: Set<() => void>;
}

const previews = new WeakMap<object, IPreviewTask>();

export const cancelSearchPreview = (owner: object) => {
    const previous = previews.get(owner);
    if (!previous) {
        return;
    }
    previews.delete(owner);
    previous.controller.abort();
    previous.cleanups.forEach(cleanup => cleanup());
    previous.cleanups.clear();
};

// 每个预览编辑器独立取消请求及短期观察器，切换结果时不保留上一结果的后台任务。
export const beginSearchPreview = (owner: object, connected: () => boolean) => {
    cancelSearchPreview(owner);
    const task: IPreviewTask = {controller: new AbortController(), cleanups: new Set()};
    previews.set(owner, task);
    const isCurrent = () => previews.get(owner) === task && !task.controller.signal.aborted && connected();
    return {
        signal: task.controller.signal,
        isCurrent,
        addCleanup: (cleanup: () => void) => {
            if (!isCurrent()) {
                cleanup();
                return () => {};
            }
            task.cleanups.add(cleanup);
            return () => task.cleanups.delete(cleanup);
        },
    };
};
