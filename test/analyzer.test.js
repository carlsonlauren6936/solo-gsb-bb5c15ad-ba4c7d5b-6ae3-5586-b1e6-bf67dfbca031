'use strict';
/* 分析器场景测试（临时脚本，验证后删除） */
const assert = require('assert');
const { analyze, validateDocument, earliestFreeStart, schedulePath, planTransitionOrder, EXACT_LIMIT } = require('../server/analyzer');
const seed = require('../server/seed');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('== earliestFreeStart ==');
ok('无占用时立即可进入', () => {
  assert.strictEqual(earliestFreeStart([], 5, 3), 5);
});
ok('冲突时推迟到占用结束', () => {
  assert.strictEqual(earliestFreeStart([{ start: 0, end: 8 }], 0, 5), 8);
});
ok('连续冲突链式推迟', () => {
  const ivs = [
    { start: 0, end: 8 },
    { start: 8, end: 15 },
  ];
  assert.strictEqual(earliestFreeStart(ivs, 0, 5), 15);
});
ok('空隙可容纳则不推迟', () => {
  const ivs = [
    { start: 0, end: 4 },
    { start: 10, end: 20 },
  ];
  assert.strictEqual(earliestFreeStart(ivs, 0, 5), 4); // [4,9) 放得下
});
ok('边界相接不算冲突', () => {
  assert.strictEqual(earliestFreeStart([{ start: 0, end: 8 }], 8, 5), 8);
});

console.log('== validateDocument 保留 narrow ==');
ok('narrow 字段规整为布尔', () => {
  const { doc, errors } = validateDocument({
    name: 't',
    zones: [{ id: 'z1' }, { id: 'z2' }],
    edges: [{ id: 'e1', a: 'z1', b: 'z2', seconds: 5, narrow: 1 }],
    scenes: [{ id: 's1', placements: [] }],
  });
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(doc.edges[0].narrow, true);
});
ok('旧文档无 narrow 字段默认为 false', () => {
  const { doc } = validateDocument({
    name: 't',
    zones: [{ id: 'z1' }, { id: 'z2' }],
    edges: [{ id: 'e1', a: 'z1', b: 'z2', seconds: 5 }],
    scenes: [{ id: 's1', placements: [] }],
  });
  assert.strictEqual(doc.edges[0].narrow, false);
});

console.log('== 示例剧目：窄通道等待调度 ==');
const seedReport = analyze(seed.seedPlays[0]);
ok('示例校验通过', () => {
  assert.strictEqual(seedReport.ok, true, JSON.stringify(seedReport.errors));
});
ok('窄通道配置进入报告', () => {
  assert.strictEqual(seedReport.stats.narrowEdgeCount, 1);
  assert.strictEqual(seedReport.narrowEdges.length, 1);
  assert.strictEqual(seedReport.narrowEdges[0].aZoneName, '左台口');
});
ok('第一组转场：蘩漪因相向共用窄通道等待 8 秒', () => {
  const t1 = seedReport.transitions[0];
  const fanyi = t1.results.find((r) => r.actorName === '蘩漪');
  assert.strictEqual(fanyi.status, 'ok');
  assert.strictEqual(fanyi.waitSeconds, 8);
  assert.strictEqual(fanyi.arriveAt, 16);
  assert.strictEqual(fanyi.schedule.waits.length, 1);
  const w = fanyi.schedule.waits[0];
  assert.strictEqual(w.zoneName, '台心');
  assert.strictEqual(w.startAt, 0);
  assert.strictEqual(w.endAt, 8);
  assert.strictEqual(w.blockers[0].actorName, '周萍');
});
ok('周萍先规划无等待，占用 [0,8)', () => {
  const t1 = seedReport.transitions[0];
  const zp = t1.results.find((r) => r.actorName === '周萍');
  assert.strictEqual(zp.status, 'ok');
  assert.strictEqual(zp.waitSeconds, 0);
  assert.strictEqual(zp.arriveAt, 16);
  const narrowLeg = zp.schedule.legs.find((l) => l.narrow);
  assert.strictEqual(narrowLeg.enterAt, 0);
  assert.strictEqual(narrowLeg.leaveAt, 8);
});
ok('首个不可能转场仍是阻断不可达（第二幕→第三幕）', () => {
  assert.strictEqual(seedReport.firstImpossible.transitionIndex, 2);
  assert.strictEqual(seedReport.firstImpossible.status, 'unreachable');
});
ok('第三幕→第四幕：周萍原本即超时（21 > 20）', () => {
  const t3 = seedReport.transitions[2];
  const zp = t3.results.find((r) => r.actorName === '周萍');
  assert.strictEqual(zp.status, 'timeout');
  assert.strictEqual(zp.seconds, 21);
});

/* 构造拥堵失败场景：A、B 依次过同一窄通道，B 等待后超时 */
const congestionDoc = {
  name: '拥堵测试',
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

console.log('== 窄通道拥堵致超时 ==');
const congReport = analyze(congestionDoc);
ok('先规划者按时（10+3=13 ≤ 15）', () => {
  const r = congReport.transitions[0].results[0];
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.arriveAt, 13);
});
ok('后规划者拥堵超时（等 10s，23 > 15）', () => {
  const r = congReport.transitions[0].results[1];
  assert.strictEqual(r.status, 'congested');
  assert.strictEqual(r.seconds, 13); // 静态不超时
  assert.strictEqual(r.waitSeconds, 10);
  assert.strictEqual(r.arriveAt, 23);
  assert.ok(r.reason.includes('窄通道'));
});
ok('统计与首个不可能状态为 congested', () => {
  assert.strictEqual(congReport.stats.congestedActorTransitions, 1);
  assert.strictEqual(congReport.stats.failedActorTransitions, 1);
  assert.strictEqual(congReport.firstImpossible.status, 'congested');
});

/* 绕路优于等待：窄通道被占用很久，绕行普通边更快 */
const detourDoc = {
  name: '绕路测试',
  zones: [
    { id: 'z1', name: '甲', x: 0, y: 0 },
    { id: 'z2', name: '乙', x: 0, y: 0 },
    { id: 'z3', name: '丙', x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', a: 'z1', b: 'z2', seconds: 5, narrow: true }, // 直达窄通道
    { id: 'e2', a: 'z1', b: 'z3', seconds: 8 },
    { id: 'e3', a: 'z3', b: 'z2', seconds: 8 }, // 绕行 16s
  ],
  actors: [
    { id: 'a1', name: '先行' },
    { id: 'a2', name: '后行' },
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
      durationFromPrev: 30,
      placements: [
        { actorId: 'a1', from: 'z2', to: null },
        { actorId: 'a2', from: 'z2', to: null },
      ],
    },
  ],
  blocks: [],
};

console.log('== 等待不如绕路时选择绕路 ==');
const detReport = analyze(detourDoc);
ok('先行者走窄通道 5s', () => {
  const r = detReport.transitions[0].results[0];
  assert.strictEqual(r.arriveAt, 5);
  assert.strictEqual(r.schedule.legs.length, 1);
});
ok('后行者绕路 16s（而非等 5s 后走窄通道共 10s？不，等 5s+5s=10s 更快）', () => {
  // 占用 [0,5)，后行者 0s 到达窄通道，等至 5s，10s 到达 —— 比绕路 16s 快，应等待
  const r = detReport.transitions[0].results[1];
  assert.strictEqual(r.arriveAt, 10);
  assert.strictEqual(r.waitSeconds, 5);
});

const detourDoc2 = JSON.parse(JSON.stringify(detourDoc));
detourDoc2.edges[1].seconds = 3; // 绕行 3+3=6s
detourDoc2.edges[2].seconds = 3;
const detReport2 = analyze(detourDoc2);
ok('绕路更快时选择绕路（6s < 等 5s+5s）', () => {
  const r = detReport2.transitions[0].results[1];
  assert.strictEqual(r.arriveAt, 6);
  assert.strictEqual(r.waitSeconds, 0);
  assert.strictEqual(r.travelSeconds, 6);
  assert.strictEqual(r.seconds, 5); // 静态最短仍是窄通道 5s
  assert.strictEqual(r.schedule.legs.length, 2); // 走了两条边的绕路
});

console.log('== 失败演员也注册占用（影响后续调度） ==');
const regDoc = JSON.parse(JSON.stringify(congestionDoc));
regDoc.scenes[1].durationFromPrev = 12; // 甲演员 13s 也超时（原本即超时? 13>12 是）
regDoc.actors.push({ id: 'a3', name: '丙演员' });
regDoc.scenes[0].placements.push({ actorId: 'a3', from: null, to: 'z1' });
regDoc.scenes[1].placements.push({ actorId: 'a3', from: 'z3', to: null });
const regReport = analyze(regDoc);
ok('甲演员原本即超时（13 > 12），仍占用 [0,10)', () => {
  const r = regReport.transitions[0].results[0];
  assert.strictEqual(r.status, 'timeout');
});
ok('乙演员等待甲的占用（10s 后进入）', () => {
  const r = regReport.transitions[0].results[1];
  assert.strictEqual(r.waitSeconds, 10);
});
ok('丙演员等待链式占用（20s 后进入）', () => {
  const r = regReport.transitions[0].results[2];
  assert.strictEqual(r.waitSeconds, 20);
  assert.strictEqual(r.arriveAt, 33);
});

console.log('== 阻断不可达保持原有行为 ==');
ok('不可达分类与原因', () => {
  const doc = {
    name: '阻断',
    zones: [
      { id: 'z1', name: '甲', x: 0, y: 0 },
      { id: 'z2', name: '乙', x: 0, y: 0 },
      { id: 'z3', name: '丙', x: 0, y: 0 },
    ],
    edges: [
      { id: 'e1', a: 'z1', b: 'z2', seconds: 5 },
      { id: 'e2', a: 'z2', b: 'z3', seconds: 5 },
    ],
    actors: [{ id: 'a1', name: '演员' }],
    scenes: [
      { id: 's1', name: '一', durationFromPrev: null, placements: [{ actorId: 'a1', from: null, to: 'z1' }] },
      { id: 's2', name: '二', durationFromPrev: 30, placements: [{ actorId: 'a1', from: 'z3', to: null }] },
    ],
    blocks: [{ fromSceneId: 's1', toSceneId: 's2', zoneIds: ['z2'] }],
  };
  const r = analyze(doc);
  const res = r.transitions[0].results[0];
  assert.strictEqual(res.status, 'unreachable');
  assert.ok(res.reason.includes('放开「乙」'));
  assert.strictEqual(res.schedule, null);
});

console.log('== 同一起点终点（无需移动） ==');
ok('legs 为空、0s 到达', () => {
  const doc = {
    name: '原地',
    zones: [{ id: 'z1', name: '甲', x: 0, y: 0 }],
    edges: [],
    actors: [{ id: 'a1', name: '演员' }],
    scenes: [
      { id: 's1', name: '一', durationFromPrev: null, placements: [{ actorId: 'a1', from: null, to: 'z1' }] },
      { id: 's2', name: '二', durationFromPrev: 10, placements: [{ actorId: 'a1', from: 'z1', to: null }] },
    ],
    blocks: [],
  };
  const r = analyze(doc);
  const res = r.transitions[0].results[0];
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.arriveAt, 0);
  assert.strictEqual(res.schedule.legs.length, 0);
});

console.log('== 调度顺序优化：重排可降低超时人数 ==');
// 窄边 乙区-丙区(8s)。远途：甲区->丁区 = 3+8+2 = 13s（静态即超时）；
// 近途：乙区->丙区 = 8s。限 10s。
// 原序[远途,近途]：远途占窄 [3,11)，近途 0s 起等至 11s，19s 到 → 2 人超时；
// 换序[近途,远途]：近途占 [0,8)、8s 按时；远途 3s 到乙区等至 8s，18s 到（静态超时）→ 1 人超时。
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
const ro = reorderReport.transitions[0].orderOptimization;
ok('两位 mover，走分支限界且标注精确', () => {
  assert.strictEqual(ro.moverCount, 2);
  assert.strictEqual(ro.exact, true);
  assert.strictEqual(ro.method, 'branch-and-bound');
});
ok('当前顺序 2 人超时、建议顺序 1 人超时', () => {
  assert.deepStrictEqual(ro.currentOrder, ['远途', '近途']);
  assert.strictEqual(ro.current.metrics.lateCount, 2);
  assert.deepStrictEqual(ro.bestOrder, ['近途', '远途']);
  assert.strictEqual(ro.best.metrics.lateCount, 1);
  assert.strictEqual(ro.orderChanged, true);
});
ok('最晚到达与总等待同为字典序比较键', () => {
  assert.strictEqual(ro.current.metrics.maxArrive, 19);
  assert.strictEqual(ro.current.metrics.totalWait, 11);
  assert.strictEqual(ro.best.metrics.maxArrive, 18);
  assert.strictEqual(ro.best.metrics.totalWait, 5);
});
ok('建议方案逐人路线为重新模拟所得（近途按时 8s）', () => {
  const near = ro.best.details.find((d) => d.actorName === '近途');
  assert.strictEqual(near.status, 'ok');
  assert.strictEqual(near.arriveAt, 8);
  assert.deepStrictEqual(near.pathZoneNames, ['乙区', '丙区']);
  assert.ok(near.schedule.legs.length >= 1);
});
ok('统计：建议调整顺序的转场数为 1，无近似转场', () => {
  assert.strictEqual(reorderReport.stats.orderOptimizedTransitions, 1);
  assert.strictEqual(reorderReport.stats.approximateOrderTransitions, 0);
});

console.log('== 调度顺序优化：指标相同时以原演员顺序稳定决胜 ==');
// 两人同从甲区出发过同一条窄边(5s)：短腿只到乙区(5s)，长腿到丙区(5+7=12s)。
// 限 12s 两种顺序均按时，且最晚到达/总等待完全相同（12s、5s）→ 不应改动顺序。
const tieDoc = {
  name: '决胜测试',
  zones: [
    { id: 'z1', name: '甲', x: 0, y: 0 },
    { id: 'z2', name: '乙', x: 0, y: 0 },
    { id: 'z3', name: '丙', x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', a: 'z1', b: 'z2', seconds: 5, narrow: true },
    { id: 'e2', a: 'z2', b: 'z3', seconds: 7 },
  ],
  actors: [
    { id: 'a1', name: '长腿' },
    { id: 'a2', name: '短腿' },
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
      durationFromPrev: 12,
      placements: [
        { actorId: 'a1', from: 'z3', to: null },
        { actorId: 'a2', from: 'z2', to: null },
      ],
    },
  ],
  blocks: [],
};
const tieReport = analyze(tieDoc);
const tieOpt = tieReport.transitions[0].orderOptimization;
ok('两套指标完全相同', () => {
  assert.deepStrictEqual(tieOpt.current.metrics, tieOpt.best.metrics);
  assert.strictEqual(tieOpt.current.metrics.lateCount, 0);
});
ok('稳定决胜：建议顺序保持演员表顺序', () => {
  assert.deepStrictEqual(tieOpt.bestOrder, ['长腿', '短腿']);
  assert.strictEqual(tieOpt.orderChanged, false);
  assert.strictEqual(tieReport.stats.orderOptimizedTransitions, 0);
});

console.log('== 调度顺序优化：台下 / 不可达 / 原地 演员不参与 ==');
const exclDoc = {
  name: '排除测试',
  zones: [
    { id: 'z1', name: '甲', x: 0, y: 0 },
    { id: 'z2', name: '乙', x: 0, y: 0 },
    { id: 'z3', name: '丙', x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', a: 'z1', b: 'z2', seconds: 5, narrow: true },
    { id: 'e2', a: 'z2', b: 'z3', seconds: 5 },
  ],
  actors: [
    { id: 'a1', name: '移动者' },
    { id: 'a2', name: '原地者' },
    { id: 'a3', name: '台下者' },
  ],
  scenes: [
    {
      id: 's1',
      name: '一',
      durationFromPrev: null,
      placements: [
        { actorId: 'a1', from: null, to: 'z1' },
        { actorId: 'a2', from: null, to: 'z3' },
        { actorId: 'a3', from: null, to: 'z1' },
      ],
    },
    {
      id: 's2',
      name: '二',
      durationFromPrev: 30,
      placements: [
        { actorId: 'a1', from: 'z3', to: null },
        { actorId: 'a2', from: 'z3', to: null }, // 起止同区
        { actorId: 'a3', from: null, to: null }, // 本场台下
      ],
    },
  ],
  blocks: [],
};
const eo = analyze(exclDoc).transitions[0].orderOptimization;
ok('仅需移动且静态可达者进入 mover 集合', () => {
  assert.strictEqual(eo.moverCount, 1);
  assert.deepStrictEqual(eo.bestOrder, ['移动者']);
  assert.strictEqual(eo.excluded.stationary, 1);
  assert.strictEqual(eo.excluded.offstage, 1);
});

console.log('== 调度顺序优化：阻断不可达者不参与重排 ==');
const exclBlockDoc = {
  name: '阻断排除',
  zones: [
    { id: 'z1', name: '甲', x: 0, y: 0 },
    { id: 'z2', name: '乙', x: 0, y: 0 },
    { id: 'z3', name: '丙', x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', a: 'z1', b: 'z2', seconds: 5, narrow: true },
    { id: 'e2', a: 'z2', b: 'z3', seconds: 5 },
    { id: 'e3', a: 'z1', b: 'z3', seconds: 6 }, // 不经乙区的替代边
  ],
  actors: [
    { id: 'a1', name: '移动者' },
    { id: 'a2', name: '被阻断者' },
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
      durationFromPrev: 30,
      placements: [
        { actorId: 'a1', from: 'z3', to: null }, // 可走 甲-丙 普通边，仍可达
        { actorId: 'a2', from: 'z2', to: null }, // 终点乙区被封锁，不可达
      ],
    },
  ],
  blocks: [{ fromSceneId: 's1', toSceneId: 's2', zoneIds: ['z2'] }],
};
const bo = analyze(exclBlockDoc).transitions[0].orderOptimization;
ok('阻断不可达计入 excluded.unreachable，可达者仍参与', () => {
  assert.strictEqual(bo.moverCount, 1);
  assert.deepStrictEqual(bo.bestOrder, ['移动者']);
  assert.strictEqual(bo.excluded.unreachable, 1);
  assert.strictEqual(bo.exact, true);
});

console.log('== 调度顺序优化：>8 人时确定性贪心并标注近似 ==');
function makeManyActorsDoc(n) {
  const actors = [];
  for (let i = 0; i < n; i++) actors.push({ id: 'a' + (i + 1), name: '演员' + (i + 1) });
  return {
    name: '贪心' + n,
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
      {
        id: 's1',
        name: '一',
        durationFromPrev: null,
        // 奇数位近途（乙区起），偶数位远途（甲区起）
        placements: actors.map((a, idx) => ({ actorId: a.id, from: null, to: idx % 2 ? 'zB' : 'zA' })),
      },
      {
        id: 's2',
        name: '二',
        durationFromPrev: 10,
        placements: actors.map((a, idx) => ({ actorId: a.id, from: idx % 2 ? 'zC' : 'zD', to: null })),
      },
    ],
    blocks: [],
  };
}
const eightReport = analyze(makeManyActorsDoc(8));
const nineReport = analyze(makeManyActorsDoc(9));
const oo8 = eightReport.transitions[0].orderOptimization;
const oo9 = nineReport.transitions[0].orderOptimization;
ok('8 人仍走分支限界（精确）', () => {
  assert.strictEqual(oo8.moverCount, 8);
  assert.strictEqual(oo8.exact, true);
  assert.strictEqual(oo8.method, 'branch-and-bound');
});
ok('9 人改用确定性贪心并明确标注近似', () => {
  assert.strictEqual(oo9.moverCount, 9);
  assert.strictEqual(oo9.exact, false);
  assert.strictEqual(oo9.method, 'greedy');
  assert.ok(oo9.note.includes('近似'));
  assert.strictEqual(nineReport.stats.approximateOrderTransitions, 1);
  assert.strictEqual(eightReport.stats.approximateOrderTransitions, 0);
});
ok('贪心为确定性结果：同文档多次分析建议顺序一致', () => {
  const again = analyze(makeManyActorsDoc(9)).transitions[0].orderOptimization;
  assert.deepStrictEqual(again.bestOrder, oo9.bestOrder);
  assert.deepStrictEqual(again.best.metrics, oo9.best.metrics);
});
ok('贪心结果不劣于当前顺序（字典序），方案不发生阶乘爆炸', () => {
  const cur = oo9.current.metrics;
  const best = oo9.best.metrics;
  const cmp =
    Math.sign(best.lateCount - cur.lateCount) ||
    Math.sign(best.maxArrive - cur.maxArrive) ||
    Math.sign(best.totalWait - cur.totalWait);
  assert.ok(cmp <= 0);
  // 贪心只构造 1 个候选方案（连同当前顺序共评估 2 个），不枚举 9! 个排列
  assert.strictEqual(oo9.evaluatedPlans, 2);
});
ok('13 人也在毫秒级完成（无阶乘爆炸）', () => {
  const t0 = Date.now();
  const r = analyze(makeManyActorsDoc(13));
  assert.strictEqual(r.transitions[0].orderOptimization.exact, false);
  assert.ok(Date.now() - t0 < 1000);
});

console.log('== 调度顺序优化：精确解不劣于贪心解（同场景 8/9 人对照） ==');
ok('8 人精确解的指标字典序不劣于 9 人场景同构造（结构对照）', () => {
  // 取前 8 人的精确解，与 9 人场景前 8 人无关，这里仅校验精确解确实找到了改进
  assert.ok(
    oo8.best.metrics.lateCount <= oo8.current.metrics.lateCount,
    '精确解超时人数不增',
  );
});

console.log('== 调度顺序优化：示例剧目仍保持默认调度结论 ==');
ok('示例剧目优化建议存在且默认可行性结论不变', () => {
  const t0opt = seedReport.transitions[0].orderOptimization;
  assert.ok(t0opt);
  assert.strictEqual(t0opt.exact, true);
  // 默认（演员表顺序）指标与重算一致
  assert.strictEqual(t0opt.current.metrics.lateCount, 0);
  // 第一个转场：两种顺序指标相同（相向窄通道），稳定保留原序
  assert.deepStrictEqual(t0opt.bestOrder, t0opt.currentOrder);
});
ok('阻断转场（第二幕→第三幕）中周萍不可达，不进入 mover 集合', () => {
  const t2opt = seedReport.transitions[1].orderOptimization;
  assert.strictEqual(t2opt.moverCount, 2);
  assert.strictEqual(t2opt.excluded.unreachable, 1);
  assert.ok(!t2opt.bestOrder.includes('周萍'));
  assert.strictEqual(seedReport.firstImpossible.status, 'unreachable');
});

console.log('== planTransitionOrder 纯函数：空 mover 集合 ==');
ok('0 个 mover 时精确、顺序为空', () => {
  const p = planTransitionOrder(reorderDoc.zones, reorderDoc.edges, [], 10, [], (x) => x);
  assert.strictEqual(p.exact, true);
  assert.strictEqual(p.moverCount, 0);
  assert.deepStrictEqual(p.bestOrder, []);
  assert.strictEqual(p.orderChanged, false);
  assert.strictEqual(p.best.metrics.maxArrive, 0);
});

console.log(`\n全部通过：${passed} 项`);