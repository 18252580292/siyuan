export interface IHomeDoc {
    rootID: string;
    title?: string;
    icon?: string;
    viewedAt?: number; // 服务端返回的 Unix 秒。
}

export interface IHomeDocDetails {
    id: string;
    content?: string;
    hpath?: string;
    updated?: string;
    cover?: string;
}

// 同时打开多个首页时合并在途请求；请求结束即释放，避免缓存过期的文档内容或权限。
export const createHomeRequestPool = () => {
    const pending = new Map<string, Promise<unknown>>();
    return <T>(key: string, request: () => Promise<T>): Promise<T> => {
        if (pending.has(key)) {
            return pending.get(key) as Promise<T>;
        }
        const promise = Promise.resolve().then(request).finally(() => {
            if (pending.get(key) === promise) {
                pending.delete(key);
            }
        });
        pending.set(key, promise);
        return promise;
    };
};

export const getHomeDocs = (data: unknown, limit = 8): IHomeDoc[] => {
    if (!Array.isArray(data)) {
        return [];
    }
    const seen = new Set<string>();
    const docs: IHomeDoc[] = [];
    for (const doc of data) {
        if (!doc || typeof doc.rootID !== "string" || !/^\d{14}-[a-z0-9]{7}$/.test(doc.rootID) || seen.has(doc.rootID)) {
            continue;
        }
        seen.add(doc.rootID);
        const viewedAt = Number(doc.viewedAt);
        docs.push({rootID: doc.rootID, title: typeof doc.title === "string" ? doc.title : "",
            icon: typeof doc.icon === "string" ? doc.icon : "", viewedAt: Number.isFinite(viewedAt) && viewedAt > 0 && viewedAt <= 8640000000000 ? viewedAt : 0});
        if (docs.length >= Math.max(1, Math.min(8, limit))) {
            break;
        }
    }
    return docs;
};

export const getHomeDetailsStatement = (docs: IHomeDoc[], closedNotebooks: Iterable<string> = []) => {
    const ids = getHomeDocs(docs).map(doc => `'${doc.rootID}'`).join(",");
    if (!ids) {
        return "";
    }
    const excluded = [...new Set(closedNotebooks)].filter(id => /^\d{14}-[a-z0-9]{7}$/.test(id)).map(id => `'${id}'`).join(",");
    // 根块元数据与最多十六个索引块中的段落组成预览，不加载或排序整篇文档。
    return "SELECT d.id, substr(d.hpath,1,256) AS hpath, d.updated, " +
        "COALESCE(NULLIF(substr(d.memo,1,180),''),(SELECT substr(p.content,1,180) FROM " +
        "(SELECT content,type,parent_id FROM blocks b WHERE b.root_id=d.id LIMIT 16) p WHERE p.type='p' " +
        "AND EXISTS(SELECT 1 FROM blocks parent WHERE parent.id=p.parent_id AND parent.type IN ('d','h')) LIMIT 1)) AS content, " +
        "CASE WHEN instr(d.ial,'title-img=')>0 THEN substr(d.ial,instr(d.ial,'title-img='),1024) ELSE '' END AS cover " +
        `FROM blocks d WHERE d.type='d' AND d.id IN (${ids})${excluded ? ` AND d.box NOT IN (${excluded})` : ""} LIMIT 8`;
};

export const getHomeCoverURL = (style: string) => {
    const attr = style?.match(/^title-img="([^"]*)"/);
    if (attr) {
        style = attr[1].replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
    }
    const match = style?.match(/background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/i);
    if (!match) {
        return "";
    }
    let path: string;
    try {
        path = decodeURIComponent(match[1].trim());
    } catch {
        return "";
    }
    // 卡片只按需展示工作空间内的已有图片，拒绝外部地址和越界路径。
    if (!/^assets\/.+\.(png|jpe?g|webp|gif|avif)$/i.test(path) || path.split("/").includes("..") || /[%\\]/.test(path) ||
        Array.from(path).some(character => character.charCodeAt(0) < 32)) {
        return "";
    }
    return "/" + path.split("/").map(part => encodeURIComponent(part)).join("/");
};
