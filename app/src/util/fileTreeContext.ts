import {Constants} from "../constants";

export const getFileTreeRenderContext = (editingPublishAccess: boolean) => JSON.stringify([
    window.siyuan.config.readonly, window.siyuan.isPublish, window.siyuan.config.fileTree,
    window.siyuan.config.appearance.lang, window.siyuan.storage[Constants.LOCAL_IMAGES], editingPublishAccess,
]);
