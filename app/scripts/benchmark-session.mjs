import {execFile} from "node:child_process";
import {createRequire} from "node:module";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

const appPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(appPath, "package.json"));
const ts = require("typescript");
const args = process.argv.slice(2);
const argument = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = resolve(argument("baseline-source"));
const output = resolve(argument("output"));
const compile = path => ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const sources = {};
for (const [name, root] of [["before", baseline], ["after", join(appPath, "src")]]) {
    sources[name] = Object.fromEntries(["protyle/scroll/viewport.ts", "util/fileTreeRefresh.ts", "protyle/render/chartRender.ts"]
        .map(path => [path, compile(join(root, path))]));
}
const chartOption = compile(join(appPath, "src/protyle/render/chartOption.ts"));

const runCases = async (source, optionSource, echartsPath, variant) => {
    const compileModule = (code, dependencies = {}) => {
        const exports = {};
        new Function("exports", "require", code)(exports, name => dependencies[name] || {});
        return exports;
    };
    const viewport = compileModule(source["protyle/scroll/viewport.ts"]);
    const tree = compileModule(source["util/fileTreeRefresh.ts"]);
    const root = document.createElement("div");
    root.style.cssText = "height:500px;width:600px;overflow:auto";
    root.innerHTML = Array.from({length:10000}, (_, index) => `<div data-node-id="block-${index}" style="height:${20+index%15}px;margin-bottom:4px">Paragraph ${index}</div>`).join("");
    document.body.append(root);
    let reads = 0;
    for (const block of root.children) {
        const measure = block.getBoundingClientRect.bind(block);
        block.getBoundingClientRect = () => { reads++; return measure(); };
    }
    const viewportCases = [];
    for (const index of [0,100,5000,9999]) {
        const targetTop = root.children[index].getBoundingClientRect().top + 1;
        reads = 0;
        const id = viewport.getVisibleRootBlockIDFromElements(root.children, targetTop, targetTop+400);
        viewportCases.push({index,id,geometryReads:reads});
    }
    root.remove();

    const list = document.createElement("ul");
    document.body.append(list);
    const files = Array.from({length:10000}, (_, index) => ({id:String(index), title:`Note ${index}`, path:`/${index}.sy`}));
    let generated = 0;
    let parsed = 0;
    const render = file => { generated++; return `<li data-node-id="${file.id}"><span class="b3-list-item__arrow"></span><span>${file.title}</span></li>`; };
    const createElement = document.createElement.bind(document);
    const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML");
    document.createElement = function(tag, options) {
        const element = createElement(tag,options);
        if (tag === "template") {
            Object.defineProperty(element,"innerHTML",{set(html){innerHTML.set.call(element,html);parsed+=element.content.childElementCount;}});
        }
        return element;
    };
    const update = () => variant === "after" ? tree.refreshFileTreeRows(list, files, "default", render) :
        tree.refreshFileTreeChildren(list,files.map(render).join(""));
    update();
    const counts = [];
    const observer = new MutationObserver(() => {});
    observer.observe(list,{childList:true,subtree:true});
    for (const name of ["unchanged", "renameOne"]) {
        if (name === "renameOne") files[5000].title = "Renamed";
        generated = parsed = 0;
        const start = performance.now();
        update();
        const durationMs = performance.now()-start;
        const mutations = observer.takeRecords();
        counts.push({name,generatedRows:generated,parsedRows:parsed,durationMs,
            added:mutations.reduce((sum,record)=>sum+record.addedNodes.length,0),
            removed:mutations.reduce((sum,record)=>sum+record.removedNodes.length,0)});
    }
    observer.disconnect();
    document.createElement = createElement;
    list.remove();

    window.echarts = require(echartsPath);
    window.Lute = {UnEscapeHTMLStr:value=>value};
    window.siyuan = {config:{appearance:{mode:0}}};
    const option = compileModule(optionSource);
    const charts = compileModule(source["protyle/render/chartRender.ts"],{
        "./chartOption":option,
        "../util/echarts":{loadECharts:async()=>true},
        "../util/addScript":{addScript:async()=>true},
        "../../constants":{Constants:{PROTYLE_CDN:"/stage/protyle"}},
        "../util/hasClosest":{hasClosestByClassName:(element)=>element.closest(".protyle-wysiwyg")},
        "../../util/hostCapabilities":{getHostCapabilities:()=>({remoteKernel:false})},
        "../../util/functions":{looseJsonParse:JSON.parse},
        "../../util/escape":{escapeHtml:value=>value},
    });
    const collect = async () => {await new Promise(resolve=>setTimeout(resolve,20)); if(window.gc)window.gc(); await new Promise(resolve=>setTimeout(resolve,20)); if(window.gc)window.gc();};
    await collect();
    const heapBefore = require("node:v8").getHeapStatistics().used_heap_size;
    const weakCanvases = [];
    for (let cycle=0;cycle<30;cycle++) {
        let owner = document.createElement("div");
        owner.className = "protyle-wysiwyg";
        owner.style.width = "500px";
        let block = document.createElement("div");
        block.setAttribute("data-subtype","echarts");
        block.setAttribute("data-content",JSON.stringify({animation:false,xAxis:{type:"category",data:[1,2,3]},yAxis:{type:"value"},series:[{type:"line",data:[1,2,3]}]}));
        block.innerHTML = '<div class="protyle-icons"></div><div><span></span><div style="width:500px;height:300px"></div></div>';
        owner.append(block);
        document.body.append(owner);
        charts.chartRender(block);
        await new Promise(resolve=>setTimeout(resolve,0));
        let canvas = block.querySelector("[_echarts_instance_]");
        if(!canvas)throw new Error("Chart did not render");
        weakCanvases.push(new WeakRef(canvas));
        if(variant==="after")charts.destroyChartRender(owner);
        owner.remove();
        owner=block=canvas=null;
    }
    await collect();
    const heapAfter = require("node:v8").getHeapStatistics().used_heap_size;
    const activeCharts = weakCanvases.reduce((sum,ref)=>{
        const canvas=ref.deref();
        return sum+(canvas&&window.echarts.getInstanceByDom(canvas)?1:0);
    },0);
    const host = document.createElement("div");
    host.className = "protyle fn__none";
    const style = document.createElement("style");
    style.textContent = ".fn__none{display:none}";
    document.head.append(style);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.style.width = "500px";
    const chart = document.createElement("div");
    chart.setAttribute("data-subtype","echarts");
    chart.setAttribute("data-content",JSON.stringify({xAxis:{type:"category",data:[1,2,3]},yAxis:{type:"value"},series:[{type:"line",data:[1,2,3]}]}));
    chart.innerHTML = '<div class="protyle-icons"></div><div><span></span><div style="width:500px;height:300px"></div></div>';
    editor.append(chart);host.append(editor);document.body.append(host);
    charts.chartRender(chart);
    await new Promise(resolve=>setTimeout(resolve,20));
    const initiallyHiddenInstances = editor.querySelectorAll("[_echarts_instance_]").length;
    host.classList.remove("fn__none");
    await new Promise(resolve=>setTimeout(resolve,20));
    const chartElement = editor.querySelector("[_echarts_instance_]");
    const instance = window.echarts.getInstanceByDom(chartElement);
    if(!instance)throw new Error("Visible chart did not activate");
    host.classList.add("fn__none");
    await new Promise(resolve=>setTimeout(resolve,20));
    const hiddenAnimation = {paused:instance.getZr().animation._paused,running:instance.getZr().animation._running};
    chart.removeAttribute("data-render");
    chart.setAttribute("data-content",JSON.stringify({animation:false,xAxis:{type:"category",data:[1,2,3]},yAxis:{type:"value"},series:[{type:"line",data:[3,7,5]}]}));
    charts.chartRender(chart);
    await new Promise(resolve=>setTimeout(resolve,20));
    const hiddenOption = instance.getOption().series[0].data;
    host.classList.remove("fn__none");
    await new Promise(resolve=>setTimeout(resolve,20));
    const resumedOption = instance.getOption().series[0].data;
    const resumedAnimation = {paused:instance.getZr().animation._paused,running:instance.getZr().animation._running};
    if(variant==="after")charts.destroyChartRender(editor);else window.echarts.dispose(chartElement);
    host.remove();style.remove();
    return {viewport:viewportCases,fileTree:counts,closedChartDocuments:{cycles:30,activeCharts,heapBefore,heapAfter,heapGrowth:heapAfter-heapBefore,gcAvailable:!!window.gc},
        backgroundCharts:{initiallyHiddenInstances,hiddenAnimation,hiddenOption,resumedAnimation,resumedOption},processMemory:await process.getProcessMemoryInfo()};
};

const temporary = mkdtempSync(join(tmpdir(), "skynote-performance-"));
const harness = join(temporary, "run.cjs");
mkdirSync(dirname(output), {recursive:true});
writeFileSync(harness, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(join(temporary,"profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("js-flags","--expose-gc");
app.on("window-all-closed",()=>{});
app.whenReady().then(async()=>{
    const results={kind:"Controlled native DOM and chart lifecycle workload; not whole-application timings"};
    try{
        for(const variant of ["before","after"]){
            const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false,offscreen:true,partition:"skynote-"+variant}});
            await win.loadURL("data:text/html,<html><body style='margin:0'></body></html>");
            results[variant]=await win.webContents.executeJavaScript("("+${JSON.stringify(runCases.toString())}+")("+JSON.stringify(${JSON.stringify(sources)}[variant])+","+JSON.stringify(${JSON.stringify(chartOption)})+","+JSON.stringify(${JSON.stringify(join(appPath,"stage/protyle/js/echarts/echarts.min.js"))})+","+JSON.stringify(variant)+")");
            win.destroy();
        }
        require("node:fs").writeFileSync(${JSON.stringify(output)},JSON.stringify(results,null,2));
        console.log("Native DOM and chart lifecycle benchmark completed");
        app.exit(0);
    }catch(error){console.error(error);app.exit(1);}
});`);
try {
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    const {stdout, stderr} = await promisify(execFile)(require("electron"), [harness], {env, timeout:120000, maxBuffer:2*1024*1024});
    console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
} finally {
    rmSync(temporary, {recursive:true,force:true});
}
