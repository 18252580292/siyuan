import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getBasicChartOption} from "./chartOption";

test("standard 2D JSON configurations can render without the GL extension", () => {
    for (const type of ["line", "bar", "pie", "scatter", "graph", "heatmap"]) {
        const option = {xAxis: {type: "category"}, yAxis: {}, series: [{type, data: [1, 2, 3]}]};
        assert.deepEqual(getBasicChartOption(JSON.stringify(option)), option);
    }
    const option = {series: {type: "scatter", coordinateSystem: "geo", data: [] as number[]}};
    assert.deepEqual(getBasicChartOption(JSON.stringify(option)), option);
});

test("GL series, 3D components and mixed series keep the extension loading path", () => {
    for (const option of [
        {series: [{type: "scatter3D"}]},
        {series: [{type: "line"}, {type: "scatterGL"}]},
        {grid3D: {}, series: [{type: "bar"}]},
        {series: [{type: "scatter", coordinateSystem: "globe"}]},
    ]) {
        assert.equal(getBasicChartOption(JSON.stringify(option)), undefined);
    }
});

test("dynamic scripts, custom graphics, unknown series and responsive options retain full compatibility", () => {
    for (const content of [
        "({series: [{type: 'line', data: getData()}]})",
        "{series: [{type: 'line'}]}",
        JSON.stringify({graphic: {type: "custom"}, series: [{type: "line"}]}),
        JSON.stringify({series: [{type: "custom"}]}),
        JSON.stringify({series: [{type: "plugin-series"}]}),
        JSON.stringify({series: [{type: "line"}], media: [{option: {}}]}),
        JSON.stringify({series: [{type: "line"}], options: [{series: [{type: "bar3D"}]}]}),
        "null", "[]", "false", "", "{}",
    ]) {
        assert.equal(getBasicChartOption(content), undefined);
    }
});
