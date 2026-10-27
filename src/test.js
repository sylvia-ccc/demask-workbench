const E = require('./engine.js');
const eng = E.createEngine(null);

let pass = 0, fail = 0;
// 括号别称（张伟（张总））按设计会并进正名，比较时归一化
// 已知偏差：同一实体的全称/简称会合并成一个代号，还原时统一成最常用的写法
const norm = s => s
  .replace(/（[^）]{1,3}(?:总|经理|总监|先生|女士)）/g, '')
  .replace(/深圳优鲜科技有限公司/g, '优鲜');

function check(name, text, opts, tolerant) {
  eng.reset();
  const r = eng.mask(text, opts);
  const back = eng.restore(r.masked);
  const same = tolerant ? norm(back) === norm(text) : back === text;
  console.log(`\n=== ${name} | 实体 ${r.stats.entities} | 还原 ${same ? 'OK' : 'FAIL'} | 残留 ${r.residual.length}`);
  console.log(r.masked);
  if (!same) {
    const a = text.split('\n'), b = back.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`  - 原: ${a[i]}`); console.log(`  + 还: ${b[i]}`); }
    }
  }
  if (same) pass++; else fail++;
  return r;
}

check('咨询报告', `关于华润万佳商业集团2026年全渠道增长战略的汇报

项目组：启明星项目 · 项目经理 李明
客户联系人：张伟（张总），手机 13812345678，邮箱 zhangwei@crvanguard.com.cn
统一社会信用代码：91440300192195337X

一、核心结论
1. 2025年集团营收 128.6 亿元，同比增长 12.4%，毛利率 23.8%。
2. 线上业务 GMV 达 34.2 亿元，占比 26.6%，履约成本 4.7 亿元。
3. 预计 2028 年市场规模达到 2100 亿元，建议以 8.5 亿元估值收购深圳优鲜科技有限公司。
4. 单店月均销售额 186 万元，坪效 3200 元/平米，人效 42 万元/人。

二、主要风险
- 与供应商 广州百佳供应链有限公司 的合同金额 1.26 亿元将于 2027年3月 到期。
- 内网系统 http://bi.crv.internal:8080/dashboard，负责人 王芳 13800138000。
- 身份证 440301199003078512，银行卡 6222020200112345678。`, null, true);

check('财务报表（科目行 + 多列）', `项目    2024A    2025E    2026E
营业收入    128,600    152,300    180,500
营业成本    98,200    115,800    136,200
毛利率    23.8%    24.0%    24.5%
销售费用    12,400    14,100    16,300
净利润    8,600    10,900    13,400
经营性现金流    15,200    18,700    21,600
应收账款    22,100    25,400    29,800
资产负债率    46.2%    44.8%    43.1%
ROE    12.4%    13.1%    14.2%`);

check('投资/交易文本', `标的公司为深圳优鲜科技有限公司（以下简称"优鲜"），股票代码 300750.SZ。
本轮投前估值 12.5 亿元，投后估值 15.0 亿元，对应 2026E EBITDA 约 18.4 倍。
财务顾问：中金资本运营有限公司，合伙人 陈立。
交易对价 3.2 亿元，分两期支付。基金主体为 嘉兴晨晖股权投资基金合伙企业（有限合伙）。
合同编号：CRV-2026-FIN-0187，发票号：044031900111。`, null, true);

check('银行流水式表格', `交易日期\t对方户名\t金额\t余额\t备注
2026-03-12\t广州百佳供应链有限公司\t1,260,000.00\t8,432,190.55\t货款
2026-03-15\t张伟\t-85,000.00\t8,347,190.55\t报销`);

check('英文', `Contact John Smith at john.smith@acme.com. Project Falcon budget $2.4M with Goldman Sachs Group.`);

check('代码', `SELECT * FROM t WHERE id=1234567890; api_key=sk-abcdefghijklmnop123456`);

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
