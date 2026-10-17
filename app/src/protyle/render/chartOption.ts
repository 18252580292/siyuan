const BASIC_SERIES = new Set([
    "line", "bar", "pie", "scatter", "effectScatter", "radar", "tree", "treemap", "sunburst", "boxplot",
    "candlestick", "heatmap", "map", "parallel", "lines", "graph", "sankey", "funnel", "gauge", "pictorialBar", "themeRiver",
]);
const BASIC_COORDINATES = new Set(["cartesian2d", "polar", "geo", "singleAxis", "calendar", "parallel", "view", "none"]);

// 只有可确认的标准二维 JSON 配置省略三维扩展；脚本、自定义图形和未知类型保留完整加载路径。
export const getBasicChartOption = (content: string): any | undefined => {
    if (/3d|gl/i.test(content)) {
        return undefined;
    }
    try {
        const option = JSON.parse(content);
        if (!option || typeof option !== "object" || Array.isArray(option) || option.graphic || option.options || option.media) {
            return undefined;
        }
        const series = Array.isArray(option.series) ? option.series : [option.series];
        if (!series.length || series.some((item: {type: string, coordinateSystem?: string}) => !item || !BASIC_SERIES.has(item.type) ||
            (item.coordinateSystem && !BASIC_COORDINATES.has(item.coordinateSystem)))) {
            return undefined;
        }
        return option;
    } catch {
        return undefined;
    }
};
