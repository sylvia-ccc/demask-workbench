const E = require('./engine.js');

// 构造贴近真实咨询/金融文本的样本：反复拼接不同段落，避免缓存命中
const block = `华润万佳商业集团2025年营收128.6亿元，同比增长12.4%，毛利率23.8%。
项目组：启明星项目 · 项目经理 李明，联系人张伟 13812345678。
预计2028年市场规模达到2100亿元，建议以8.5亿元估值收购深圳优鲜科技有限公司。
与供应商广州百佳供应链有限公司的合同金额1.26亿元将于2027年3月到期，合同编号CRV-2026-FIN-0187。
营业收入	128,600	152,300	180,500
营业成本	98,200	115,800	136,200
毛利率	23.8%	24.0%	24.5%
内网系统 http://bi.crv.internal:8080/dashboard，负责人王芳 13800138000。
`;

function build(targetChars) {
  let s = '';
  let i = 0;
  while (s.length < targetChars) {
    s += block.replace(/2025/g, String(2000 + (i % 25)));
    i++;
  }
  return s.slice(0, targetChars);
}

const sizes = [10000, 50000, 100000, 300000, 500000, 1000000];
console.log('字数\t耗时(ms)\t实体数\t吞吐(万字/秒)');
for (const n of sizes) {
  const text = build(n);
  const eng = E.createEngine(null);
  const t0 = Date.now();
  const r = eng.mask(text);
  const dt = Date.now() - t0;
  const t1 = Date.now();
  eng.restore(r.masked);
  const dt2 = Date.now() - t1;
  console.log(`${n}\t${dt}\t\t${r.stats.entities}\t${(n / 10000 / (dt / 1000)).toFixed(1)}\t还原:${dt2}ms`);
}

// 局部函数耗时拆分（10 万字）
const text = build(100000);
const I = E._internal;
for (const [name, fn] of [
  ['detectMoney', I.detectMoney],
  ['detectOrgs', I.detectOrgs],
  ['detectPersons', () => I.detectPersons(text, { PERSON: [] })],
  ['detectFinRows', I.detectFinRows],
  ['detectTables', I.detectTables]
]) {
  const t = Date.now();
  const out = fn(text);
  console.log(`  ${name}: ${Date.now() - t}ms, ${out.length} 个 span`);
}

// 重叠消解的复杂度
const spans = [];
for (let i = 0; i < 6000; i++) spans.push({ start: i * 3, end: i * 3 + 2, type: 'ORG', text: 'x' + i, conf: 0.9, note: '' });
const t3 = Date.now();
I.resolveOverlaps(spans);
console.log(`  resolveOverlaps(6000 spans): ${Date.now() - t3}ms`);
