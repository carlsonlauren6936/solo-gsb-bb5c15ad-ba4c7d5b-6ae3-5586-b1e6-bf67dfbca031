'use strict';
/* 前端报告渲染与 Markdown 导出测试：在 vm 沙盒中加载真实 app.js（去掉 boot()），
 * 注入最小 DOM 桩，直接调用 renderReport / exportMarkdown 验证输出内容。 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { analyze } = require('../server/analyzer');
const seed = require('../server/seed');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 加载 app.js ----------
let src = fs.readFileSync(__dirname + '/../public/app.js', 'utf8');
src = src.replace(/\nboot\(\);\s*$/, '\n');

const elements = {};
function makeEl() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
  };
}
const ctx = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  URL,
  Blob,
  document: {
    querySelector: (sel) => (elements[sel] = elements[sel] || makeEl()),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    createElementNS: () => makeEl(),
  },
  window: { addEventListener() {} },
  fetch: async () => {
    throw new Error('fetch not available in test');
  },
});
vm.runInContext(src, ctx);

// 注入报告（示例剧目，含窄通道等待）
const report = analyze(seed.seedPlays[0]);
vm.runInContext(`state.doc = ${JSON.stringify(seed.seedPlays[0])}; state.report = ${JSON.stringify(report)};`, ctx);

// 捕获下载内容
const downloads = [];
vm.runInContext(
  `download = function (filename, content, mime) { __downloads.push({ filename, content, mime }); };`,
  Object.assign(ctx, { __downloads: downloads }),
);

console.log('== renderReport ==');
vm.runInContext('renderReport();', ctx);
const html = elements['#checkResult'].innerHTML;

ok('汇总栏包含窄通道统计', () => {
  assert.ok(html.includes('窄通道<b>1</b>'), 'narrowEdgeCount');
  assert.ok(html.includes('其中窄通道拥堵<b>0</b>'));
});
ok('首个不可能转场标注为路线被阻断', () => {
  assert.ok(html.includes('路线被阻断'));
});
ok('蘩漪结果行包含到达时间与等待标注', () => {
  assert.ok(html.includes('16s / 30s（含等待 8s）'), 'arrive/wait text');
});
ok('行程明细包含进入/离开时间与等待段', () => {
  assert.ok(html.includes('行程明细：0s 出发 → 16s 到达（含等待 8s）'));
  assert.ok(html.includes('在「台心」等待 8s'));
  assert.ok(html.includes('窄通道「台心 ↔ 左台口」正被 周萍（0s–8s） 占用'));
  assert.ok(html.includes('8s 进入「台心 → 左台口」（窄通道 · 8s）→ 16s 抵达「左台口」'));
});
ok('周萍原本即超时状态展示', () => {
  assert.ok(html.includes('超时（原本即超时）'));
  assert.ok(html.includes('21s / 20s'));
});
ok('提示区包含窄通道等待提示', () => {
  assert.ok(html.includes('受窄通道占用影响等待 8 秒'));
});

console.log('== exportMarkdown ==');
vm.runInContext('exportMarkdown();', ctx);
assert.strictEqual(downloads.length, 1);
const md = downloads[0].content;

ok('包含窄通道配置节', () => {
  assert.ok(md.includes('## 窄通道配置'));
  assert.ok(md.includes('| 左台口 ↔ 台心 | 8 秒 |'));
});
ok('包含调度明细与等待段', () => {
  assert.ok(md.includes('调度明细（按演员表顺序规划，时刻自换场开始计）'));
  assert.ok(md.includes('0s–8s 在「台心」等待窄通道（被 周萍（0s–8s） 占用）'));
  assert.ok(md.includes('8s 进入「台心 → 左台口」（窄通道），16s 抵达'));
  assert.ok(md.includes('到达 16s / 限 30s，共等待 8s'));
});
ok('表格含到达/时限与等待列', () => {
  assert.ok(md.includes('| 演员 | 状态 | 到达 / 时限 | 等待 | 路线 / 原因 |'));
  assert.ok(md.includes('| 蘩漪 | 按时可达 | 16 秒 / 30 秒 | 8 秒 |'));
});
ok('失败分类文案正确', () => {
  assert.ok(md.includes('周萍（原本即超时）') || md.includes('原本即超时'));
  assert.ok(md.includes('不可达'));
});

console.log('== 拥堵场景的渲染与导出 ==');
const congestionDoc = {
  name: '拥堵',
  zones: [
    { id: 'z1', name: '甲', x: 0, y: 0 },
    { id: 'z2', name: '乙', x: 0, y: 0 },
    { id: 'z3', name: '丙', x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', a: 'z1', b: 'z2', seconds: 10, narrow: true },
    { id: 'e2', a: 'z2', b: 'z3', seconds: 3 },
  ],
  actors: [
    { id: 'a1', name: '甲演员' },
    { id: 'a2', name: '乙演员' },
  ],
  scenes: [
    {
      id: 's1',
      name: '一',
      durationFromPrev: null,
      placements: [
        { actorId: 'a1', from: null, to: 'z1' },
        { actorId: 'a2', from: null, to: 'z1' },
      ],
    },
    {
      id: 's2',
      name: '二',
      durationFromPrev: 15,
      placements: [
        { actorId: 'a1', from: 'z3', to: null },
        { actorId: 'a2', from: 'z3', to: null },
      ],
    },
  ],
  blocks: [],
};
const congReport = analyze(congestionDoc);
vm.runInContext(`state.doc = ${JSON.stringify(congestionDoc)}; state.report = ${JSON.stringify(congReport)};`, ctx);
vm.runInContext('renderReport();', ctx);
const html2 = elements['#checkResult'].innerHTML;

ok('拥堵状态徽标与文案', () => {
  assert.ok(html2.includes('窄通道拥堵'), 'status text');
  assert.ok(html2.includes('窄通道拥堵致超时'), 'verdict text');
  assert.ok(html2.includes('23s / 15s（含等待 10s）'));
});
ok('汇总栏拥堵计数', () => {
  assert.ok(html2.includes('其中窄通道拥堵<b>1</b>'));
});

downloads.length = 0;
vm.runInContext('exportMarkdown();', ctx);
const md2 = downloads[0].content;
ok('Markdown 中拥堵原因与状态', () => {
  assert.ok(md2.includes('乙演员（窄通道拥堵）') || md2.includes('窄通道拥堵'));
  assert.ok(md2.includes('共等待 10s'));
});

console.log('== 调度顺序优化：页面渲染 ==');
const reorderDoc = {
  name: '顺序优化',
  zones: [
    { id: 'zA', name: '甲区', x: 0, y: 0 },
    { id: 'zB', name: '乙区', x: 0, y: 0 },
    { id: 'zC', name: '丙区', x: 0, y: 0 },
    { id: 'zD', name: '丁区', x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', a: 'zA', b: 'zB', seconds: 3 },
    { id: 'e2', a: 'zB', b: 'zC', seconds: 8, narrow: true },
    { id: 'e3', a: 'zC', b: 'zD', seconds: 2 },
  ],
  actors: [
    { id: 'a1', name: '远途' },
    { id: 'a2', name: '近途' },
  ],
  scenes: [
    {
      id: 's1',
      name: '一',
      durationFromPrev: null,
      placements: [
        { actorId: 'a1', from: null, to: 'zA' },
        { actorId: 'a2', from: null, to: 'zB' },
      ],
    },
    {
      id: 's2',
      name: '二',
      durationFromPrev: 10,
      placements: [
        { actorId: 'a1', from: 'zD', to: null },
        { actorId: 'a2', from: 'zC', to: null },
      ],
    },
  ],
  blocks: [],
};
const reorderReport = analyze(reorderDoc);
vm.runInContext(`state.doc = ${JSON.stringify(reorderDoc)}; state.report = ${JSON.stringify(reorderReport)};`, ctx);
vm.runInContext('renderReport();', ctx);
const html3 = elements['#checkResult'].innerHTML;

ok('展示优化面板标题与精确徽标', () => {
  assert.ok(html3.includes('调度顺序优化'));
  assert.ok(html3.includes('精确最优 · 分支限界'));
});
ok('并排展示当前顺序与建议顺序两套指标', () => {
  assert.ok(html3.includes('当前（演员表）顺序'));
  assert.ok(html3.includes('建议顺序'));
  assert.ok(html3.includes('远途 → 近途'));
  assert.ok(html3.includes('近途 → 远途'));
  // 三套字典序指标
  assert.ok(html3.includes('超时 <b>2</b> 人'));
  assert.ok(html3.includes('超时 <b>1</b> 人'));
  assert.ok(html3.includes('最晚到达 <b>19</b>s'));
  assert.ok(html3.includes('总等待 <b>11</b>s'));
});
ok('建议顺序逐人路线可展开', () => {
  assert.ok(html3.includes('建议顺序下的逐人路线与时刻（2 人）'));
  assert.ok(html3.includes('乙区 → 丙区'));
});
ok('汇总栏包含顺序优化统计', () => {
  assert.ok(html3.includes('建议调整顺序的转场<b>1</b>'));
  assert.ok(html3.includes('贪心近似转场<b>0</b>'));
});

console.log('== 调度顺序优化：>8 人近似标注 ==');
function makeManyActorsDoc(n) {
  const actors = [];
  for (let i = 0; i < n; i++) actors.push({ id: 'a' + (i + 1), name: '演员' + (i + 1) });
  return {
    name: '贪心渲染' + n,
    zones: [
      { id: 'zA', name: '甲区', x: 0, y: 0 },
      { id: 'zB', name: '乙区', x: 0, y: 0 },
      { id: 'zC', name: '丙区', x: 0, y: 0 },
      { id: 'zD', name: '丁区', x: 0, y: 0 },
    ],
    edges: [
      { id: 'e1', a: 'zA', b: 'zB', seconds: 3 },
      { id: 'e2', a: 'zB', b: 'zC', seconds: 8, narrow: true },
      { id: 'e3', a: 'zC', b: 'zD', seconds: 2 },
    ],
    actors,
    scenes: [
      { id: 's1', name: '一', durationFromPrev: null, placements: actors.map((a, idx) => ({ actorId: a.id, from: null, to: idx % 2 ? 'zB' : 'zA' })) },
      { id: 's2', name: '二', durationFromPrev: 10, placements: actors.map((a, idx) => ({ actorId: a.id, from: idx % 2 ? 'zC' : 'zD', to: null })) },
    ],
    blocks: [],
  };
}
const nineReport = analyze(makeManyActorsDoc(9));
vm.runInContext(`state.doc = ${JSON.stringify(makeManyActorsDoc(9))}; state.report = ${JSON.stringify(nineReport)};`, ctx);
vm.runInContext('renderReport();', ctx);
const html4 = elements['#checkResult'].innerHTML;
ok('9 人时页面明确标注近似', () => {
  assert.ok(html4.includes('近似方案 · 确定性贪心'));
  assert.ok(html4.includes('贪心近似转场<b>1</b>'));
});

console.log('== 调度顺序优化：导出同步包含建议方案与是否精确 ==');
downloads.length = 0;
vm.runInContext('exportJson();', ctx);
ok('JSON 导出包含 orderOptimization 与 exact 字段', () => {
  const exported = JSON.parse(downloads[0].content);
  const oo = exported.transitions[0].orderOptimization;
  assert.strictEqual(oo.exact, false);
  assert.strictEqual(oo.method, 'greedy');
  assert.ok(Array.isArray(oo.bestOrder));
  assert.strictEqual(oo.moverCount, 9);
  assert.ok(oo.current.metrics && oo.best.metrics);
});

downloads.length = 0;
vm.runInContext('exportMarkdown();', ctx);
const md3 = downloads[0].content;
ok('Markdown 导出包含建议顺序与是否精确', () => {
  assert.ok(md3.includes('调度顺序优化建议'));
  assert.ok(md3.includes('是否精确：**否（确定性贪心，近似结果）**'));
  assert.ok(md3.includes('当前（演员表）顺序：'));
  assert.ok(md3.includes('建议顺序：'));
  assert.ok(md3.includes('建议顺序逐人路线：'));
});

// 精确场景的 Markdown 标注
const mdReorderReport = analyze(reorderDoc);
vm.runInContext(`state.doc = ${JSON.stringify(reorderDoc)}; state.report = ${JSON.stringify(mdReorderReport)};`, ctx);
downloads.length = 0;
vm.runInContext('exportMarkdown();', ctx);
const md4 = downloads[0].content;
ok('精确场景 Markdown 标注为精确并列出两套指标', () => {
  assert.ok(md4.includes('是否精确：**是（分支限界全排列）**'));
  assert.ok(md4.includes('超时 2 人 / 最晚到达 19 秒 / 总等待 11 秒'));
  assert.ok(md4.includes('超时 1 人 / 最晚到达 18 秒 / 总等待 5 秒'));
  assert.ok(md4.includes('近途 → 远途'));
});

console.log(`\n全部通过：${passed} 项`);
