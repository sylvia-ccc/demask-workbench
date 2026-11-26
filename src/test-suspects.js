// 疑似实体候选的回归测试：真名要出现在候选里，会计用语和普通词不能出现
// 用法：node test-suspects.js
const E = require('./engine.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ ' + m); } };
const sugs = t => E.createEngine().mask(t, {}).suggestions.map(x => x.alias);

const MUST = [
  ['专家表示，他在字节期间负责广告业务，后于美团任副总裁，曾在极兔从事网点管理。', ['字节', '美团', '极兔']],
  ['他在滴滴期间负责增长，后于蔚来任COO，曾在理想从事产品。', ['滴滴', '蔚来', '理想']],
  ['访谈对象：鑫源房地产、华测监测科技、立讯消费电子。', ['鑫源房地产', '华测监测科技', '立讯消费电子']],
  ['本轮参与方：红杉股权投资、立铠精密科技、云栖智能科技。', ['红杉股权投资', '立铠精密科技', '云栖智能科技']],
  ['标的公司旗下支付通的牌照尚在续期。', ['支付通']]
];
const MUST_NOT = [
  '按照权益法核算的长期股权投资、其他权益工具投资和债权投资，期末按公允价值计量。回购股份用于股权激励。',
  '公司在使用期间按直线法计提折旧，于以下期间确认收入。',
  '子公司现金流量表的编制方法见附注。关联方交易的定价公允。',
  '贵州科技、电子科技等行业词不是公司名。'
];
const BAD = ['长期股权投资', '权益工具投资', '债权投资', '回购股份', '使用', '以下', '现金流量表', '交易', '贵州科技', '电子科技'];

for (const [t, names] of MUST) {
  const s = sugs(t);
  for (const n of names) ok(s.indexOf(n) >= 0, '候选里缺少「' + n + '」：' + t + ' → ' + s.join('、'));
}
for (const t of MUST_NOT) {
  const s = sugs(t);
  for (const b of BAD) ok(s.indexOf(b) < 0, '不该出现的候选「' + b + '」：' + t);
}
console.log(`\n候选测试 通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
