// 合并并发模块加载，失败后允许重试，已加载模块保留供后续功能调用。
export const createLazyModuleLoader = <T>(load: () => Promise<T>) => {
    let pending: Promise<T>;
    return () => {
        if (!pending) {
            pending = Promise.resolve().then(load).catch(error => {
                pending = undefined;
                throw error;
            });
        }
        return pending;
    };
};
