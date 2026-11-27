/* ==========================================================================
   脱敏工作台 · 引擎（纯 JS，无依赖）
   面向咨询 / 投行 / 研究的财务与商业数据脱敏。
   可同时在浏览器（window.DemaskEngine）和 Node（module.exports）中运行。
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DemaskEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 内置行业词库 ---------------- */
  const LEX = (typeof require === 'function' && typeof module === 'object')
    ? require('./lexicon.js')
    : ((typeof self !== 'undefined' ? self : globalThis).DemaskLexicon
       || { GROUPS: {}, WEAK: new Set(), GENERIC: new Set(), PSEUDO: [] });

  // 按首字分桶，避免 300 个词逐一 indexOf 拖慢长文本
  const LEX_BUCKET = new Map();
  const LEX_GROUP_OF = {};
  (function buildBucket() {
    const all = [];
    for (const g in LEX.GROUPS) {
      for (const n of LEX.GROUPS[g].orgs) {
        all.push(n);
        LEX_GROUP_OF[n] = g;
      }
    }
    if (LEX.WEAK) for (const n of LEX.WEAK) {
      if (!(n in LEX_GROUP_OF)) { all.push(n); LEX_GROUP_OF[n] = null; }
    }
    all.sort((a, b) => b.length - a.length);
    for (const n of all) {
      const k = n[0];
      if (!LEX_BUCKET.has(k)) LEX_BUCKET.set(k, []);
      LEX_BUCKET.get(k).push(n);
    }
  }());

  /* ---------------- 类型定义 ---------------- */
  const TYPES = {
    ORG:      { label: '企业/机构', prefix: '企业', color: 'org' },
    PERSON:   { label: '人名',     prefix: '人物', color: 'per' },
    PROJECT:  { label: '项目/代号', prefix: '项目', color: 'prj' },
    MONEY:    { label: '金额',     prefix: '金额', color: 'amt' },
    PCT:      { label: '比率',     prefix: '比率', color: 'amt' },
    PHONE:    { label: '电话',     prefix: '电话', color: 'sec' },
    IDCARD:   { label: '身份证',   prefix: '证件', color: 'sec' },
    BANK:     { label: '银行账户', prefix: '账户', color: 'sec' },
    EMAIL:    { label: '邮箱',     prefix: '邮箱', color: 'sec' },
    ADDR:     { label: '地址',     prefix: '地址', color: 'url' },
    SECRET:   { label: '密钥/凭证', prefix: '密钥', color: 'sec' },
    USCC:     { label: '税号/信用代码', prefix: '代码', color: 'sec' },
    IP:       { label: 'IP/内网',  prefix: 'IP',   color: 'url' },
    URL:      { label: '链接/域名', prefix: '链接', color: 'url' },
    PLATE:    { label: '车牌',     prefix: '车辆', color: 'sec' },
    TICKER:   { label: '股票代码', prefix: '股票', color: 'sec' },
    CONTRACT: { label: '合同/项目编号', prefix: '编号', color: 'sec' },
    INVOICE:  { label: '发票号',   prefix: '发票', color: 'sec' },
    ACCOUNT:  { label: '账号/证券账户', prefix: '账号', color: 'sec' },
    BIRTH:    { label: '出生日期', prefix: '日期', color: 'sec' },
    DATE:     { label: '日期（平移）', prefix: '日期', color: 'amt' },
    DEVICE:   { label: '设备标识', prefix: '设备', color: 'sec' },
    CASE:     { label: '案号/文号/权证号', prefix: '文号', color: 'sec' },
    SECURITY: { label: '证券/产品编码', prefix: '证券', color: 'sec' }
  };

  const PRIO = {
    IDCARD: 10, BANK: 10, SECRET: 10, USCC: 9, EMAIL: 9, PHONE: 8,
    ADDR: 7, URL: 6, IP: 6, PLATE: 6, TICKER: 9, CONTRACT: 9, INVOICE: 9, ACCOUNT: 11, BIRTH: 7,
    DEVICE: 9, CASE: 9, SECURITY: 9, DATE: 2,
    ORG: 5, PERSON: 5, PROJECT: 4, MONEY: 3, PCT: 1
  };

  /* ---------------- 词表 ---------------- */
  const SURNAMES =
    '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈' +
    '姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤' +
    '欧阳司马上官诸葛东方尉迟皇甫' +
    // v2.0 补充：原表约 100 个单姓，"柯振宇""戚家豪""施雨桐"整类漏掉。这里只放几乎不打头常用词的姓
    '柯戚詹葛祁阮聂仇柏邢翟殷喻鲍巫樊卜刁鄂芦冉岳饶匡裴雍郁骆耿柴' +
    '倪滕鞠蔺伍邬奚茅屈晏霍蒲璩郜粟佟淳隋荆瞿褚汝湛桑闵佘郎栗敖阙郗靳钮' +
    '邴虞苟臧韶';
  // 也是常用字的姓（管理/时间/明确/华东/路径…）：只在强引导（职务、名单、称谓、由…担任）后才认
  // 歧义档姓打头的常用词：命中就不是人名
  const AMBIG_WORDS = new Set(('管理 管控 管道 管辖 解决 解释 解读 单位 单独 单价 单店 车辆 车间 车型 包括 包装 包含 路径 路线 路演 齐全 时间 时候 时期 时代 时点 景气 简单 简称 简要 房地 房产 华东 华南 华北 华中 华西 华为 华夏 华润 连续 连锁 连接 应收 应付 应当 应用 应对 关于 关注 关联 关系 关键 明确 明年 明细 明显 符合 费用 费率 相关 相应 相比 查询 查看 荣誉 宫格 门店 门槛 门户 尚未 尚需 古典 艾瑞 商品 商业 商务 商誉 麻烦 燕麦 伏笔 乐观 昌盛 冷链 冷却 那些 那么 税务 税收 税率 税前 税后 权益 权利 权限 皮肤 毕业 丰富 丰田 康复 洪水 鲁棒 习惯 边际 边界 童装 宁可 危机 危险 兰州 迟滞 项目 季度 纪要 纪律 储备 储能 焦点 凌晨 薄弱 庞大 谈判 谈话 施工 施行 牛市 游戏 游客 颜色 卓越 衡量 廉洁 舒适 辛苦 蓝图 幸运 揭示 庄园 苗头 伊始 丛林 甘肃 池子 麦当 乔迁 成本 成功 成立 成长 成为 成交 成熟 成果 成员 盛行 盛大 区域').split(' '));
  const SURNAMES_AMBIG = '成盛项季纪储焦凌薄庞谈施牛游颜卓衡廉舒辛蓝幸揭庄苗伊丛楚甘池麦乔管解单车包路齐时景简房华连应关明符费相查荣宫门尚古翁艾商麻燕伏乐昌冷那税权皮毕丰康洪鲁习边童宁危兰迟';

  const TITLE_SUFFIX = [
    '董事长', '总裁', '总监', '经理', '副总', '先生', '女士', '小姐', '老师', '博士', '教授',
    '主任', '院长', '处长', '局长', '部长', '主管', '负责人', '合伙人', '助理',
    '董事', '监事', '法人', '代表', '董秘',
    '总(?!额|计|体|部|数|量|比|价|账|成本|收入|支出|资产|负债|股本|市值|费用|利润|经理|裁|监|局|会|公司|的)',
    'CEO', 'CFO', 'COO', 'CTO', 'VP', 'MD', 'ED'
  ].sort((a, b) => b.length - a.length).join('|');

  // 只保留"几乎只出现在机构名里"的后缀。
  // 能源/技术/资本/科技/实业 这类通用词一律移除——它们在正文里太常见，
  // 一旦当后缀就会把"移动式化石能源"整段吞成公司名。
  const ORG_SUFFIX = [
    '股份有限公司', '有限责任公司', '有限公司', '有限合伙', '合伙企业',
    '集团', '控股', '银行', '证券', '基金', '信托', '保险', '资管',
    '事务所', '研究院', '研究所', '大学', '学院', '医院',
    '农商行', '信用社', '租赁', '保理', '小贷', '创投', '金控',
    '产投', '城投', '建投', '交投', '资产管理', '财富管理', '投资管理',
    '融资租赁', '商业保理'
  ].sort((a, b) => b.length - a.length).join('|');

  const ORG_STOP = new Set([
    '公司', '该企业', '本企业', '集团', '银行', '客户', '供应商', '厂商', '行业',
    '上市企业', '中小企业', '头部企业', '外资企业', '民营企', '国企', '央企',
    '有限公司', '股份公司', '子公司', '母公司', '分公司', '总公司',
    '基金', '信托', '保险', '证券', '资管', '投行', '券商', '公募基金', '私募基金',
    '合伙企业', '有限合伙', '资产管理', '财富管理', '投资管理', '融资租赁', '担保'
  ]);

  // 金额语境词：金融/财务科目 + 交易术语
  const MONEY_CONTEXT = [
    '营业收入', '营业成本', '营收', '收入', '营业额', '销售额', '流水', 'GMV', '毛利', '净利',
    '利润', 'EBITDA', 'EBIT', '期间费用', '销售费用', '管理费用', '研发费用', '财务费用',
    '税金', '资产总额', '总资产', '资产', '负债', '所有者权益', '股东权益', '净资产',
    '应收账款', '应付账款', '存货', '货币资金', '经营性现金流', '投资性现金流', '筹资性现金流',
    '现金流', '有息负债', '商誉', '固定资产', '在建工程', '合同负债', '预收', '预付',
    '成本', '费用', '支出', '预算', '估值', '投前', '投后', '市值', '融资', '募资', '募投',
    '投资额', '合同额', '订单额', '中标额', '对价', '作价', '注册资本', '实缴', '认缴',
    '客单价', '单价', '报价', '折扣', '规模', '份额', '市占率', '市场规模', '交易额',
    '薪酬', '工资', '薪资', '年薪', '奖金', '补贴', '罚款', '赔偿', '税额', '税负',
    '应收', '应付', '库存', '授信', '额度', '担保额', '净额', '总额', '合计', '小计',
    '余额', '借方', '贷方', '发生额', '期初', '期末', '结存',
    '管理规模', 'AUM', '分红', '派息', '股息', '回购', '质押', '坪效', '人效', '单店'
  ].join('|');

  const PERSON_PREV =
    '由|与|和|向|给|请|找|联系|对接|负责|签字|审批|汇报|面谈|拜访|陪同|委托|指派|任命|担任|推荐|介绍';

  const ROLE_CUE = [
    '项目经理', '项目总监', '项目负责人', '财务总监', '财务负责人', '负责人', '联系人',
    '董事长', '董事', '监事', '总经理', '副总经理', '副总裁', '副总', '总监', '经理', '合伙人', '顾问', '专员',
    '姓名', '名字', '签名',
    '主管', '经办人', '签字人', '汇报人', '主讲人', '对接人', '创始人', '董秘', '分析师',
    '实际控制人', '实控人', '法定代表人', '法人代表', '控股股东', '大股东', '股东代表',
    '首席代表', '授权代表', '委托代理人', '主持人', '主讲', '嘉宾', '评审', '评委',
    'CEO', 'CFO', 'COO', 'CTO', 'VP', 'MD', 'ED'
  ].sort((a, b) => b.length - a.length).join('|');

  /* ---------------- 工具 ---------------- */
  function isCJK(c) { return c >= '\u4e00' && c <= '\u9fa5'; }
  function isAsciiAlpha(c) { return /[A-Za-z]/.test(c); }

  /* ---- 中文数字金额："一亿二千万元""三千五百万""壹亿贰仟万元整" ----
     以前大写金额只换成代号（AI 看不到数），小写中文数字金额干脆漏掉。
     现在一律换算成阿拉伯数字后按同一系数缩放，单位保留，AI 照样能算。 */
  const CN_D = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 壹: 1, 贰: 2, 貳: 2, 叁: 3, 參: 3, 肆: 4, 伍: 5, 陆: 6, 陸: 6, 柒: 7, 捌: 8, 玖: 9 };
  const CN_U = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
  function cnToNumber(str) {
    let total = 0, section = 0, num = 0, any = false;
    for (const ch of str) {
      if (ch in CN_D) { num = CN_D[ch]; any = true; }
      else if (ch in CN_U) { section += (num || 1) * CN_U[ch]; num = 0; any = true; }
      else if (ch === '万' || ch === '萬') { total += (section + num) * 1e4; section = 0; num = 0; }
      else if (ch === '亿' || ch === '億') { total = (total + section + num) * 1e8; section = 0; num = 0; }
      else return null;
    }
    return any ? total + section + num : null;
  }
  const CN_MONEY_RE = /((?:人民币|RMB|港币|美元)?\s?)([零〇一二两三四五六七八九十百千万亿壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬億]{1,16})(亿元|万元|元|圆|亿美元|万美元|美元|亿港元|万港元|港元|亿|万)(整|正)?/g;
  const CN_MONEY_CTX = /金额|对价|估值|营收|收入|利润|融资|投资|价格|价款|成本|费用|预算|规模|市值|资金|资本|出资|借款|贷款|授信|担保|罚款|赔偿|合同|标的|交易|支付|总价|总额|余额|注册资本|募资|募集/;
  function detectCnMoney(text) {
    const out = [];
    CN_MONEY_RE.lastIndex = 0;
    let m;
    while ((m = CN_MONEY_RE.exec(text)) !== null) {
      const digits = m[2], unit = m[3];
      if (!/[零〇一二两三四五六七八九壹贰貳叁參肆伍陆陸柒捌玖]/.test(digits)) continue;     // 至少有一个数字
      if (!/[十百千万亿拾佰仟萬億]/.test(digits + unit)) continue;                          // "一二元"这种不是金额
      const hasYuan = /元|圆|美元|港元/.test(unit);
      // 只有一个字的数（"三亿""五万元"）：必须有金额语境，"三元""一万"太容易是别的意思
      if (digits.length === 1 && !CN_MONEY_CTX.test(text.slice(Math.max(0, m.index - 12), m.index) + text.slice(m.index - 3, m.index))) {
        if (!/亿|万/.test(unit)) continue;
        if (!/[，,；;、。]/.test(text.slice(Math.max(0, m.index - 6), m.index)) || !CN_MONEY_CTX.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
      }
      // 只有"亿 / 万"、没有"元"时，要求前面不远处有金额语境（"十万火急""三千万用户"不算）
      if (!hasYuan && !CN_MONEY_CTX.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
      if (!hasYuan && /^[一-龥]/.test(text[m.index + m[0].length] || '') && !/^(?:的|左右|上下|以上|以下|以内|多|余)/.test(text.slice(m.index + m[0].length))) continue;
      // "三万多人""五千万户"：后面跟着量词的是数量，不是金额
      if (!hasYuan && /^(?:多|余)?(?:人|户|家|台|个|名|位|辆|套|间|件|吨|股|份|张|次|笔)/.test(text.slice(m.index + m[0].length))) continue;
      let v = cnToNumber(digits + (/^亿/.test(unit) ? '亿' : /^万/.test(unit) ? '万' : ''));
      if (v === null || v <= 0) continue;
      // 用原文的数量级做单位：有"亿"按亿，有"万"按万，否则按元
      const big = /亿|億/.test(digits + unit) ? '亿' : /万|萬/.test(digits + unit) ? '万' : '';
      const cur = unit.replace(/^[亿万]/, '') || (hasYuan ? '' : '');
      const n = big === '亿' ? v / 1e8 : big === '万' ? v / 1e4 : v;
      const numStr = String(Math.round(n * 1e6) / 1e6);
      const st = m.index + m[1].length;
      const sp = Span(st, m.index + m[0].length, 'MONEY', text.slice(st, m.index + m[0].length), 0.95, '中文数字金额');
      sp.cn = { num: numStr, unit: big + (cur || (big ? '' : '元')), tail: cur || (big ? '' : '元') };
      sp.cn.unitWord = big ? big + (cur || '') : (cur || '元');
      out.push(sp);
    }
    return out;
  }

  function Span(start, end, type, text, conf, note) {
    return { start, end, type, text, conf: conf == null ? 1 : conf, note: note || '' };
  }

  function idcardOk(s) {
    if (s.length !== 18) return false;
    const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const m = '10X98765432';
    let total = 0;
    for (let i = 0; i < 17; i++) {
      const d = s.charCodeAt(i) - 48;
      if (d < 0 || d > 9) return false;
      total += d * w[i];
    }
    return s[17].toUpperCase() === m[total % 11];
  }

  // IPv6：最多一个 "::"；每段 1–4 位十六进制；不压缩时必须 8 段；排除 14:05:12 这类时间
  function ipv6Ok(v) {
    if (!/\d/.test(v) || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(v)) return false;
    const dbl = v.split('::');
    if (dbl.length > 2) return false;
    const segs = dbl.map(x => x ? x.split(':') : []);
    const all = segs[0].concat(segs[1] || []);
    if (!all.every(g => /^[0-9A-Fa-f]{1,4}$/.test(g))) return false;
    if (dbl.length === 1) return all.length === 8;
    return all.length <= 7 && (/[A-Fa-f]/.test(v) || all.length >= 2);
  }

  // IBAN：把前 4 位挪到末尾，字母转数字，对 97 取余应为 1
  function ibanOk(s) {
    const c = s.replace(/\s/g, '').toUpperCase();
    if (c.length < 15 || c.length > 34) return false;
    const r = c.slice(4) + c.slice(0, 4);
    let rem = 0;
    for (const ch of r) {
      if (ch >= '0' && ch <= '9') rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
      else if (ch >= 'A' && ch <= 'Z') rem = (rem * 100 + (ch.charCodeAt(0) - 55)) % 97;
      else return false;
    }
    return rem === 1;
  }
  // 占位符不是密钥：your_api_key / example / xxxx / ****** / 示例
  function secretPlausible(v) {
    if (/^[*xX•·.]+$/.test(v)) return false;
    if (/example|sample|placeholder|your|changeme|change_me|dummy|fake|mock|todo|replace|insert|redacted|xxxx|示例|占位|你的/i.test(v)) return false;
    if (/^(?:process\.env|os\.environ|\$\{|\{\{|<)/.test(v)) return false;
    return true;
  }

  function luhnOk(s) {
    const d = s.replace(/\D/g, '');
    if (d.length < 14 || d.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function usccOk(s) {
    const chars = '0123456789ABCDEFGHJKLMNPQRTUWXY';
    const w = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
    if (s.length !== 18) return false;
    let total = 0;
    for (let i = 0; i < 17; i++) {
      const k = chars.indexOf(s[i]);
      if (k < 0) return false;
      total += k * w[i];
    }
    return chars[(31 - total % 31) % 31] === s[17];
  }

  // 人名判定的最后一道闸。年报的"公司治理"章全是"任公司董事长""现任董事"
  // 这类表述，光靠姓氏首字会大量误判——必须排除职务/机构词素。
  const NAME_BAD_PARTS = /包括|包含|以及|还有|高级|资深|首席|^方授|^方代|双方|各方|对方|法定|公司|董事|监事|经理|总裁|职工|现任|任期|担任|兼任|执行|财务|采购|销售|独立|兼职|联席|办公室|委员会|集团|股份|有限|证券|银行|基金|上海|北京|深圳|广州|杭州|南京|成都|武汉|西安|苏州|天津|重庆|宁波|青岛|程序|关联|遴选|考核|评估|治理|结构|调整|运营|生产|研发|技术|质量|安全|环保|人力|行政|任职|副董|司副|^副|副$/;
  const COMPOUND_SURNAME = /^(?:欧阳|司马|上官|诸葛|东方|皇甫|尉迟|公孙|慕容|长孙|宇文|司徒|司空|夏侯|令狐|端木|独孤|南宫|西门|百里|东郭|呼延|羊舌|微生|梁丘|左丘|东门|南荣)$/;
  const COMPOUND_PAIRS = '欧阳 司马 上官 诸葛 东方 皇甫 尉迟 公孙 慕容 长孙 宇文 司徒 司空 夏侯 令狐 端木 独孤 南宫 西门 百里 东郭 呼延 羊舌 微生 梁丘 左丘 东门 南荣'.split(' ');

  // "欧阳楚英先生" 会被从"阳"开始匹配成"阳楚英"——候选前一个字若与首字构成复姓，说明切错了
  function cutInsideCompound(text, start, cand) {
    if (start <= 0) return false;
    const prev = text[start - 1];
    const two = prev + cand[0];
    return COMPOUND_PAIRS.indexOf(two) >= 0;
  }

  function looksLikeName(s, strong) {
    if (!s || s.length < 2 || s.length > 4) return false;
    if (SURNAMES.indexOf(s[0]) < 0 && !(strong && SURNAMES_AMBIG.indexOf(s[0]) >= 0)) return false;
    if (SURNAMES.indexOf(s[0]) < 0) {
      // 歧义档：时间 / 管理层 / 项目组 / 华东区 / 季度复盘 / 华为
      if (AMBIG_WORDS.has(s.slice(0, 2))) return false;
      if (/[层组区部队方会处科室局院所司业务期度项线面级量率额]$/.test(s)) return false;
    }
    const BAD = ['高管', '高工', '高级', '方式', '方法', '方案', '成本', '成功', '成果',
      '金额', '金融', '历史', '周期', '周边', '于是', '余下', '余额', '余量', '余款', '徐缓', '王国', '马上'];
    if (BAD.indexOf(s) >= 0 || /^(?:余额|余量|余款)/.test(s)) return false;
    // 组织单元不是人名：华东大区 / 东大区 / 华南区域
    if (/大区|区域|片区|城市|省份|部门|事业部/.test(s)) return false;
    // 职务/机构词素不是人名：任公司 / 董事会 / 司职工 / 董事和
    if (NAME_BAD_PARTS.test(s)) return false;
    // 复姓单独出现（"欧阳"后面还有名）不当作完整人名
    if (COMPOUND_SURNAME.test(s)) return false;
    return true;
  }

  /* ---- 真实文体里的人名补充 ----
     "成明和，男，1961 年出生"（履历）、"成明和 男 63 副董事长"（董监高表格）、
     "龙腾的老板老陈""跟小李说"（口语里的老/小 + 姓）。 */
  function detectBioPersons(text) {
    const out = [];
    let m;
    const bio = /(?:^|[\n\t（(）)、，。；;：:\d]\s*)([\u4e00-\u9fa5]{2,4})(?:\s*[，,]\s*|\s+)(男|女)(?:\s*[，,]\s*|\s+)(?=\d{2,4}|汉族|中国|出生|生于|博士|硕士|本科|大专|研究生|籍贯|国籍|无境外|现任|曾任)/g;
    while ((m = bio.exec(text)) !== null) {
      const name = m[1];
      if (!looksLikeName(name, true) || COMMON_2.has(name)) continue;
      const st = m.index + m[0].indexOf(name);
      out.push(Span(st, st + name.length, 'PERSON', name, 0.9, '履历'));
    }
    const lao = /(?<![\u4e00-\u9fa5])|(?<=老板|老总|客户|对接人|联系人|董事长|总经理|经理|总监|跟|和|与|找|问|给|让|叫|是|的)/;
    void lao;
    const re = /(老|小)([王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤])(?![\u4e00-\u9fa5]{0,1}(?:时|候|区|鼠|虎|龙|姐|弟|妹|哥|孩|朋友|学|伙|子|板|公|婆|乡|家|师|鸟|麦|米|吃|费|说法))/g;
    while ((m = re.exec(text)) !== null) {
      const prev = text.slice(Math.max(0, m.index - 3), m.index);
      const next = text.slice(m.index + 2, m.index + 4);
      const before = /(?:老板|老总|客户|对接人|联系人|董事长|总经理|经理|总监|跟|和|与|找|问|给|让|叫|是|的|[，。；：、\s（(“"]|^)$/.test(prev) || m.index === 0;
      const after = /^(?:说|讲|提|表示|认为|那边|他们|她们|这边|的|是|也|就|其实|在|跟|和|$|[，。；：、！？\s）)”"])/.test(next) || m.index + 2 >= text.length;
      if (!(before && after)) continue;
      out.push(Span(m.index, m.index + 2, 'PERSON', m[0], 0.8, '老/小+姓'));
    }
    return out;
  }
  /* ---- 没有任何提示词的姓名：表格单元格、名单、句首 ----
     用"安全姓氏 + 常见名用字"打分，并要求两边是单元格或标点边界（"张连山 至 2010 年""乔玉文、乔玉华"）。 */
  const GIVEN = new Set(('伟芳娜敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂英华玉萍红建文辉力林鹏宇浩凯俊健帅斌峰波宁欣婷雪琳晶颖慧丹倩莉燕梅兰凤洁琴云霖博晨阳鑫鸿坤亮飞龙海东晓雨思佳怡嘉涵轩睿泽宏志国庆立新春秋冬金成忠福永胜德安民正光荣祥振兴家锋毅群清晴蕾璐瑶薇媛婕琪琦菲露萌彤悦妍楠昊然逸航哲铭栋伦震彬炜晖骏腾翔舒雅茜楚晗曦冰岚洪江山岩松柏榕桐梓远达宾信义仁智勤良贤婉淑珍珠翠碧青彩虹琼瑞祺祯喜乐欢和康泰恒昌盛隆富豪雄威武锐坚卫守捷聪玲琳瑜璇璟瑾琨瑛玮连毓群蕴卿爽怀耀灿炎焱鹤麟凌川帆旭昕暄翰墨彦奕宸钧铮锦颢烨琛瑄璋珏蓓馨芸莹萱蓉芝蔚')
    .split(''));
  const NAME_EDGE_L = /[\n\t、，,；;：:（(）)\s|｜]|^$/;
  const NAME_EDGE_R = /^(?:$|[\n\t、，,；;：:（(）)\s|｜。]|先生|女士|同志|老师|博士|教授|律师|为(?:公司|一致|实际|控股|董事|监事|法定|本)|等[人\d一二三四五六七八九十]|之[妻夫子女弟兄妹姐父母])/;
  function detectPlainNames(text) {
    const out = [];
    const re = /[王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤乔]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const i = m.index;
      if (!NAME_EDGE_L.test(text[i - 1] || '')) continue;
      for (const L of [3, 2]) {
        const cand = text.slice(i, i + L);
        if (cand.length < L || !/^[\u4e00-\u9fa5]+$/.test(cand)) continue;
        if (![...cand.slice(1)].every(c => GIVEN.has(c))) continue;
        if (!NAME_EDGE_R.test(text.slice(i + L, i + L + 2))) continue;
        if (!looksLikeName(cand, true) || COMMON_2.has(cand) || AMBIG_WORDS.has(cand.slice(0, 2))) continue;
        if (/^(?:高新|金融|方正|万达|华润|陆家|东方|安信|国信|中信|海通|平安|光大|招商|华泰|国泰|方圆|和平|江山|黄金|白银|石油|马上|钱江|龙华|万科|于是|余下)/.test(cand)) continue;
        out.push(Span(i, i + L, 'PERSON', cand, 0.75, '姓名统计'));
        break;
      }
    }
    return out;
  }

  /* ---- 真实文体里的机构补充 ----
     合同当事方（"乙方嘉宏电子每季度…"）、邮件签名里的公司行、"X 拟在科创板上市"。 */
  const PARTY_RE = /(?:甲方|乙方|丙方|丁方|卖方|买方|出让方|受让方|转让方|投资方|被投资方|借款人|贷款人|出租方|承租方|委托方|受托方|发包方|承包方)(为|是|：|:)?\s*([\u4e00-\u9fa5]{2,12}?)(?=每|向|应|须|需|将|于|按|已|同意|承诺|负责|保证|收到|支付|提供|供货|，|。|；|、|（|\(|\s|$)/g;
  const PARTY_BAD = /市场|分析师|研报|机构|尽调|普遍|认为|施工|爸爸|方面|一方|代表|人员|团队|律师|顾问|意见|要求|需求|报价|立场|角度|视角|利益|风险|责任|义务|权利|资金|股东|董事/;
  const ORG_TAIL = /(?:电子|科技|资本|投资|集团|控股|实业|医疗|医药|智能|精密|新材|物流|生物|化工|汽车|能源|股份|公司|基金|银行|证券|信托|保险|置业|地产|传媒|食品|贸易|咨询|管理)$/;
  function detectContextOrgs(text) {
    const out = [];
    let m;
    PARTY_RE.lastIndex = 0;
    while ((m = PARTY_RE.exec(text)) !== null) {
      const sep = m[1], name = m[2];
      if (PARTY_BAD.test(name) || /^(?:房东|业主|房主|租客|客户|对方|本人|自然人)$/.test(name)) continue;
      // 没有"为 / 是 / ："分隔时（"卖方研报认为"），名字必须像公司（行业词尾）或像人名，且不长于 6 个字
      if (!sep && !(ORG_TAIL.test(name) && name.length <= 8) && !(name.length <= 4 && looksLikeName(name, true))) continue;
      if (name.length < 2 || ORG_STOP.has(name) || COMMON_2.has(name) || /^(?:公司|本公司|双方|各方|一方|对方|其|该|上述|以下|指定|授权|代表|法定)/.test(name)) continue;
      if (/^[供支提收同承负保应须需将按已向于签履交付退违解终有在对就因如若与和及或不可]/.test(name)) continue;   // "乙方应于…""甲方同意"：动词，不是名字
      if (/(?:人|方|者|机构|单位|主体)$/.test(name)) continue;              // "丙方为担保人"：角色，不是名字
      const st0 = m.index + m[0].lastIndexOf(name);
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(name) && looksLikeName(name, true) && !/(?:电子|科技|资本|投资|集团|控股|实业|医疗|医药)$/.test(name)) {
        out.push(Span(st0, st0 + name.length, 'PERSON', name, 0.85, '合同当事人')); continue;
      }
      if (!nameRemainderOk(name) && !/(?:电子|科技|资本|投资|集团|控股|实业|医疗|医药|智能|精密|新材|物流|生物|化工|汽车|能源)$/.test(name)) continue;
      const st = m.index + m[0].lastIndexOf(name);
      out.push(Span(st, st + name.length, 'ORG', name, 0.85, '合同当事方'));
    }
    // 邮件签名：姓名 | 职务 下一行（或紧邻电话、邮箱的上一行）是公司名
    const sig = /(?:^|\n)[^\n|｜]{2,30}[|｜][^\n|｜]{2,20}\n([\u4e00-\u9fa5A-Za-z&（）() ]{2,30})\n(?=[^\n]{0,6}(?:手机|电话|Tel|Mobile|M[:：]|T[:：]|邮箱|Email|E[:：]|地址))/gi;
    while ((m = sig.exec(text)) !== null) {
      const name = m[1].trim();
      if (name.length < 2 || /^(?:谢谢|此致|敬礼|祝好|Best|Regards|Thanks)/i.test(name) || /(?:完成|中|部|待定|状态|项目|备注|进行|处理)$/.test(name)) continue;
      const st = m.index + m[0].lastIndexOf(m[1]);
      out.push(Span(st, st + m[1].trimEnd().length, 'ORG', name, 0.85, '邮件签名'));
    }
    // "X 拟在科创板上市"：上市主体
    const ipo = /(?:^|[，。；：、\s（(“"]|显示|公告|消息|据悉|其中)([\u4e00-\u9fa5]{2,10}?)(?=(?:拟|计划|正在|已|将)(?:在|于|赴)(?:上交所|深交所|北交所|港交所|联交所|科创板|创业板|主板|纳斯达克|纽交所)(?:科创板|创业板|主板)?(?:上市|IPO|挂牌|递表))/g;
    while ((m = ipo.exec(text)) !== null) {
      const name = m[1];
      if (ORG_STOP.has(name) || COMMON_2.has(name) || /^(?:公司|本公司|发行人|标的|该公司|其|这家|多家|部分|今年|去年|明年|近期|近年|近两年|近三年|目前|已有|共有|未来)/.test(name) || /多家|企业|公司|几家|一批/.test(name)) continue;
      const st = m.index + m[0].indexOf(name);
      out.push(Span(st, st + name.length, 'ORG', name, 0.85, '上市主体'));
    }
    return out;
  }

  /* ---- 会议纪要、聊天记录里的发言人 ----
     "张伟：我认为……""张伟 10:32""Kevin Liu 2025-03-01 10:32:11"——
     行首的人名后面紧跟冒号或时间，是最常见、也最不该漏的格式。 */
  const SPEAKER_LABEL = /^(?:周[一二三四五六日天末]|星期[一二三四五六日天]|上午|中午|下午|晚上|早上|傍晚|今天|明天|昨天|后天|本周|下周|上周|本月|下月|上月|今年|明年|去年|本季|全年|上半年|下半年|主持人?|参会人?员?|与会人?员?|出席|列席|记录人?|时间|地点|议题|主题|结论|备注|问|答|提问|回答|总结|会议|纪要|附件|日期|事项|决议|待办|行动项|下一步|背景|目的|说明|发言|嘉宾|专家|客户|我方|对方|甲方|乙方|公司|项目|标的|来源|摘要|要点|问题|风险|建议|结果|状态|负责人|联系人|电话|邮箱|地址|网址|注|按|即|其中|合计|小计|总计|单位|金额)$/;
  function detectSpeakers(text) {
    const found = new Map();      // 名字 -> 出现为发言人的次数
    const lineRe = /(^|\n)[ \t]*([一-龥]{2,4}|[A-Z][a-z]+(?: [A-Z][a-z]+){1,2})[ \t]*(?:[（(][^）)\n]{1,30}[）)])?[ \t]*(?:([:：])|(?:\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?[ \t]+)?\d{1,2}:\d{2}(?::\d{2})?[ \t]*(?=\n|$))/g;
    let m;
    while ((m = lineRe.exec(text)) !== null) {
      const name = m[2];
      if (SPEAKER_LABEL.test(name)) continue;
      if (/^[一-龥]/.test(name)) {
        // 冒号式：要求是像样的人名；歧义姓（"华东：""时间："）只有反复出现才算
        if (!looksLikeName(name, true)) continue;
        if (COMMON_2.has(name) || AMBIG_WORDS.has(name.slice(0, 2))) continue;
        if (/[店区路街市县镇厅馆园场部组线]$/.test(name)) continue;          // 王府井店：/ 高新区：/ 华东线：
      } else if (EN_SUSPECT_BAD.test(name.split(' ')[0])) continue;
      // 带时间戳的更可信；英文"Xxx Yyy："常是小标题（Term Sheet：/ Next Steps：），要出现两次才算
      found.set(name, (found.get(name) || 0) + (m[3] ? (/^[A-Z]/.test(name) ? 0.5 : 1) : 2));
    }
    // 参会名单里的英文名："参会人：张伟、李明、Kevin Liu"
    const listRe = /(?:参会|与会|出席|列席|参加|嘉宾|attendees?|participants?)[人员者]*[：:]([^\n]{2,200})/gi;
    while ((m = listRe.exec(text)) !== null) {
      for (const part of m[1].split(/[、，,;；\/]/)) {
        const x = part.trim();
        if (/^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/.test(x) && !EN_SUSPECT_BAD.test(x.split(' ')[0])) found.set(x, (found.get(x) || 0) + 2);
      }
    }
    // 只有冒号、没有时间戳的中文发言人：要有两个以上不同的人在说话，才像纪要或对话（"周一：""李宁："单独出现不算）
    const cjkColon = [...found].filter(([n, sc]) => /^[一-龥]/.test(n) && sc < 2);
    const cjkTimed = [...found].filter(([n, sc]) => /^[一-龥]/.test(n) && sc >= 2);
    if (cjkColon.length + cjkTimed.length < 2) for (const [n] of cjkColon) found.set(n, 0);
    // 对话里已经确认有英文发言人：同样格式的其他英文名也算（"Kevin Liu: …⏎Anna Chen: …"）
    const EN_HEAD = /^(?:Term Sheet|Next Steps?|Action Items?|Key (?:Takeaways?|Points?|Terms?)|Due Diligence|Executive Summary|Deal Terms?|Use Of Proceeds|Investment Thesis|Risk Factors?)$/i;
    const enOk = [...found].some(([n, sc]) => /^[A-Z]/.test(n) && sc >= 1 && !EN_HEAD.test(n));
    for (const [n, sc] of found) {
      if (!/^[A-Z]/.test(n)) continue;
      if (EN_HEAD.test(n)) found.set(n, 0);
      else if (enOk && sc < 1) found.set(n, 1);
    }
    const out = [];
    for (const [name, score] of found) {
      const amb = /^[一-龥]/.test(name) && SURNAMES.indexOf(name[0]) < 0;
      if (score < (amb ? 3 : 1)) continue;
      let i = -1;
      while ((i = text.indexOf(name, i + 1)) >= 0) {
        // 中文名：前后不能紧贴别的汉字（"张伟明"里的"张伟"不算）
        if (/^[一-龥]/.test(name) && (/[一-龥]/.test(text[i - 1] || '') && !/[：:，,、\s]/.test(text[i - 1] || '') && !/[请和与跟让给向找问]/.test(text[i - 1] || '')) ) continue;
        out.push(Span(i, i + name.length, 'PERSON', name, 0.9, '发言人'));
      }
    }
    return out;
  }

  /* ---------------- 检测器：规则类 ---------------- */
  /* ---- 补充的强格式标识（对照个人金融信息与去标识化相关规范补齐）：
     卡片安全码与有效期、密保答案、外国人永居证、军官证、登录名、保单号、公积金/社保账号、
     MAC / IMEI / 车架号、案号 / 处罚文号 / 不动产权证号、ISIN / LEI / 私募备案编码。
     能校验的都校验（IMEI、VIN、ISIN、LEI），其余必须有标签引导。 */
function luhnOk(d) {
    let s = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = d.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      s += n; alt = !alt;
    }
    return s % 10 === 0;
  }
  // VIN 第 9 位校验位（ISO 3779 / 北美与国标通用）
  function vinOk(v) {
    v = v.toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
    const tr = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
    const w = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < 17; i++) { const c = v[i]; s += (/\d/.test(c) ? +c : tr[c]) * w[i]; }
    const r = s % 11, chk = r === 10 ? 'X' : String(r);
    return v[8] === chk;
  }
  // ISIN：字母换成数字后做 Luhn
  function isinOk(x) {
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(x)) return false;
    const d = x.split('').map(c => /\d/.test(c) ? c : String(c.charCodeAt(0) - 55)).join('');
    return luhnOk(d);
  }
  // LEI：ISO 17442，整体 mod 97 == 1
  function leiOk(x) {
    if (!/^[A-Z0-9]{18}\d{2}$/.test(x)) return false;
    let r = 0;
    for (const c of x) { const v = /\d/.test(c) ? c : String(c.charCodeAt(0) - 55); for (const d of v) r = (r * 10 + +d) % 97; }
    return r === 1;
  }
  
  const RULES = [
    // 认证辅助信息（最高敏感）：必须有标签
    { type: 'SECRET', note: 'CVV', re: /(?:CVV2?|CVN2?|CVC|安全码|卡背后三位)\s*(?:码)?\s*[:：为是]?\s*(\d{3,4})(?!\d)/gi },
    { type: 'SECRET', note: '卡片有效期', re: /(?:有效期(?:至|到)?|有效期限|Valid\s*(?:Thru|Until)|EXP(?:IRY)?)\s*[:：为是]?\s*((?:0[1-9]|1[0-2])\s*\/\s*(?:\d{2}|20\d{2}))(?!\d)/gi, ctx: /卡|CVV|CVC|CVN|安全码|Card|VISA|Master/i },
    { type: 'SECRET', note: '密码提示答案', re: /(?:密保问题答案|密码提示(?:答案|问题)?|安全问题答案)\s*[:：为是]\s*([^\s，。；,;]{1,30})/g },
    // 证件
    { type: 'IDCARD', note: '外国人永居证', re: /(?:永久居留(?:身份)?证|永居证|绿卡)(?:号码?|号)?\s*[:：为是]?\s*([A-Z]{3}\d{12}|9\d{17}|9\d{16}X)(?![\dA-Z])/g },
    { type: 'IDCARD', note: '军官证/士兵证', re: /(?:军官证|士兵证|文职干部证|警官证)(?:号码?|号)?\s*[:：为是]?\s*([一-龥]{0,4}字?第?\s*\d{6,10}号?)/g },
    // 账号类（带标签）
    { type: 'ACCOUNT', note: '登录名', re: /(?:登录名|登录账号|用户名|账户名|Username|Login(?:\s*ID)?)\s*[:：为是]\s*([A-Za-z][A-Za-z0-9_.@-]{3,40})/gi },
    { type: 'ACCOUNT', note: '保单号', re: /(?:保单号(?:码)?|保险单号|Policy\s*No\.?)\s*[:：为是]?\s*([A-Z0-9][A-Z0-9-]{7,29})/gi },
    { type: 'ACCOUNT', note: '公积金/社保账号', re: /(?:公积金(?:个人)?账号|社保(?:个人)?编号|医保(?:卡)?号)\s*[:：为是]?\s*([A-Z0-9]{8,20})/g },
    // 设备与网络标识
    { type: 'DEVICE', note: 'MAC 地址', re: /(?<![0-9A-Fa-f:-])((?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2})(?![0-9A-Fa-f:-])/g },
    { type: 'DEVICE', note: 'IMEI', re: /(?:IMEI|MEID|设备串号|手机串号)\s*(?:号|码)?\s*[:：为是]?\s*(\d{15})(?!\d)/gi, check: v => luhnOk(v) },
    { type: 'DEVICE', note: 'VIN', re: /(?<![A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/g, check: v => /\d/.test(v) && /[A-Z]/.test(v) && vinOk(v) },
    // 司法与行政文号
    // 案号：（年份）+ 法院代字 + 案件类型字（初/终/再/申/执/破……）+ 序号 + 号（可带"之一"）
    { type: 'CASE', note: '案号', re: /([（(]\s*(?:19|20)\d{2}\s*[)）]\s*[一-龥]{1,3}\s*\d{0,4}\s*[一-龥]{0,4}(?:初|终|再|申|执|破|特|监|督|保|赔|撤|恢|清|协|外|认|算|调|刑|民|行|商|知)[一-龥]{0,2}\s*\d{1,6}\s*号(?:之[一二三四五六七八九十])?)/g },
    // 行政处罚 / 决定文号（公开发文字号"国发〔2024〕5号"不算：那是法规，AI 需要看到）
    { type: 'CASE', note: '处罚/决定文号', re: /([一-龥]{1,14}(?:罚字|罚决字|处罚字|处罚决定书|决定书|决字|监决|罚)\s*[〔\[【(（]\s*(?:19|20)\d{2}\s*[〕\]】)）]\s*第?\s*\d{1,6}\s*号)/g },
    { type: 'CASE', note: '不动产权证号', re: /([一-龥]{1,2}\s*[（(]\s*(?:19|20)\d{2}\s*[)）]\s*[一-龥]{0,10}?(?:不动产权|房权证|房地权证)\s*第?\s*\d{5,10}\s*号)/g },
    // 证券与产品标识
    { type: 'SECURITY', note: 'ISIN', re: /(?<![A-Z0-9])([A-Z]{2}[A-Z0-9]{9}\d)(?![A-Z0-9])/g, check: isinOk },
    { type: 'SECURITY', note: 'LEI', re: /(?<![A-Z0-9])([A-Z0-9]{18}\d{2})(?![A-Z0-9])/g, check: leiOk },
    { type: 'SECURITY', note: '私募备案编码', re: /(?:备案编码|备案号|基金备案)\s*[:：为是]?\s*(S[A-Z0-9]{5})(?![A-Z0-9])/g }
  ];
  
  function detectExtra(text) {
    const out = [];
    for (const r of RULES) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(text)) !== null) {
        const v = m[1];
        if (r.check && !r.check(v.replace(/\s/g, ''))) continue;
        if (r.ctx && !r.ctx.test(text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20))) continue;
        const st = m.index + m[0].indexOf(v);
        out.push(Span(st, st + v.length, r.type, v, 0.95, r.note));
      }
    }
    return out;
  }

  /* ---- 日期平移（可选）：签约日、交割日、公告日这类完整日期能锁定具体交易 ----
     打开后，所有带年月日的日期按同一个隐藏天数整体挪动（同一项目内固定），间隔天数不变，
     AI 照样能算账期、工期；回复贴回来按对照表还原。只有年份或只有月份的不动。 */
  const DATE_RE = /((?:19|20)\d{2})(年|-|\/|\.)(0?[1-9]|1[0-2])(月|-|\/|\.)(0?[1-9]|[12]\d|3[01])(日|号)?(?![\d])/g;
  const MD_RE = /(?<![\d年\-\/.])(0?[1-9]|1[0-2])月(0?[1-9]|[12]\d|3[01])(日|号)(?![\d])/g;
  const WEEK = '日一二三四五六';
  function detectDates(text, refYear) {
    const out = [];
    const taken = new Uint8Array(text.length + 1);
    DATE_RE.lastIndex = 0;
    let m;
    while ((m = DATE_RE.exec(text)) !== null) {
      if (/\d/.test(text[m.index - 1] || '')) continue;
      const sep1 = m[2], sep2 = m[4];
      if (sep1 === '年' ? sep2 !== '月' : sep1 !== sep2) continue;        // 2025年3-1 这种不算
      if (sep1 === '年' && !m[6]) continue;                               // 2025年3月15（没有"日"）不算
      if (sep1 === '.' && (m[3].length < 2 || m[5].length < 2)) continue; // 2021.3.1 多半是版本号
      const y = +m[1], mo = +m[3], d = +m[5];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() !== mo - 1) continue;                          // 2月30日不是日期
      let end = m.index + m[0].length;
      const wk = text.slice(end).match(/^\s?[（(]?(?:星期|周|礼拜)[一二三四五六日天][）)]?/);
      if (wk) end += wk[0].length;
      const sp = Span(m.index, end, 'DATE', text.slice(m.index, end), 0.9, '日期平移');
      // 补零：横杠/斜杠/点写法按原样（两位就补零）；"年月日"写法只有原文带 0 才补
      const pad = sep1 === '年' ? (/^0/.test(m[3]) || /^0/.test(m[5])) : (m[3].length === 2 || m[5].length === 2);
      sp.date = { y, mo, d, fmt: { sep1, sep2, tail: m[6] || '', pad: pad, week: wk ? wk[0] : '' } };
      out.push(sp);
      for (let i = m.index; i < end; i++) taken[i] = 1;
    }
    // 只有月日（"3月5日"）：按文中最近的年份推算，平移后同样只写月日
    MD_RE.lastIndex = 0;
    while ((m = MD_RE.exec(text)) !== null) {
      if (taken[m.index]) continue;
      // 没有年份：固定按平年推算（去掉闰年差异，平移和还原才对得上）；星期几推不出来，直接去掉
      const y = 2001;
      void refYear;
      const mo = +m[1], d = +m[2];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() !== mo - 1) continue;
      let end = m.index + m[0].length;
      const wk = text.slice(end).match(/^\s?[（(]?(?:星期|周|礼拜)[一二三四五六日天][）)]?/);
      if (wk) end += wk[0].length;
      const sp = Span(m.index, end, 'DATE', text.slice(m.index, end), 0.9, '日期平移');
      sp.date = { y, mo, d, fmt: { sep1: '', sep2: '月', tail: m[3], pad: false, md: true, week: '' } };
      out.push(sp);
    }
    return out;
  }
  function fmtDate(t, f) {
    const p = n => f.pad ? String(n).padStart(2, '0') : String(n);
    let s = f.md ? (t.getUTCMonth() + 1) + '月' + t.getUTCDate() + f.tail
      : t.getUTCFullYear() + f.sep1 + p(t.getUTCMonth() + 1) + f.sep2 + p(t.getUTCDate()) + f.tail;
    if (f.week) s += f.week.replace(/[一二三四五六日天](?=[）)]?$)/, WEEK[t.getUTCDay()]);
    return s;
  }

  // 粗判"灾难性回溯"写法：带量词的分组外面再套量词，或分组里有可互相覆盖的分支再加量词
  function unsafeRegex(p) {
    // 先把转义和字符类压成一个占位字符，再按括号深度找"被量词修饰的分组"
    const src = p.replace(/\\./g, 'x').replace(/\[(?:\\.|[^\]])*\]/g, 'x');
    const stack = [];
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '(') stack.push(i);
      else if (c === ')' && stack.length) {
        const st = stack.pop();
        let inner = src.slice(st + 1, i).replace(/^\?(?::|=|!|<=|<!|<[A-Za-z_]\w*>)/, '');
        const after = src.slice(i + 1);
        const q = after.match(/^(?:[+*]|\{(\d+)(,(\d*))?\})/);
        if (!q) continue;
        const repeats = q[0] === '+' || q[0] === '*' || (q[2] !== undefined) || (+q[1] >= 2);
        if (!repeats) continue;
        const unbounded = /[+*]|\{\d+,\}/.test(inner);
        const alt = /\|/.test(inner);
        // 分组以固定字面量开头（"-[A-Z0-9]+"）时，每次重复的边界唯一，不会回溯爆炸
        const anchoredLiteral = /^[^\\.()x[+*?{|^$]/.test(inner);
        if (alt) return true;
        if (unbounded && !anchoredLiteral) return true;
      }
    }
    return false;
  }


  function detectRegex(text) {
    const out = [];

    // 带捕获组的规则：只替换捕获到的部分，别把"公告编号：""Contact: "这类引导词一起吃掉
    function add(re, type, conf, validate, note) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        let st = m.index, val = m[0];
        if (m.length > 1 && typeof m[1] === 'string' && m[1] && m[1].length < m[0].length) {
          const gi = m[0].indexOf(m[1]);
          if (gi > 0) { st = m.index + gi; val = m[1]; }
        }
        if (validate && !validate(val)) continue;
        out.push(Span(st, st + val.length, type, val, conf, note));
      }
    }

    add(/(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
      'IDCARD', 1, idcardOk, 'GB11643 校验通过');
    // 结构像身份证但校验位不对：仍按证件处理，别退化成银行卡
    add(/(?<!\d)[1-5]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
      'IDCARD', 0.8, null, '身份证结构');
    add(/(?<!\d)1[3-9]\d{9}(?!\d)/g, 'PHONE', 0.98, null, '');
    // 手机带分隔：138 0013 8000 / 138-0013-8000
    add(/(?<![\d-])1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?![\d-])/g, 'PHONE', 0.95, null, '手机分组');
    add(/(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?:[-\s]?\d{1,5})?(?!\d)/g, 'PHONE', 0.9, null, '');
    // 座机区号带括号：(021) 5888-1234
    add(/(?<![\d-])\(0\d{2,3}\)\s*\d{3,4}[-\s]?\d{4}(?![\d-])/g, 'PHONE', 0.92, null, '区号括号');
    // 座机四位分组：0755-8666 7890
    add(/(?<![\d-])0\d{2,3}[-\s]\d{3,4}[-\s]\d{4}(?![\d-])/g, 'PHONE', 0.9, null, '四位分组');
    // 15 位老身份证：校验出生日期是否合法，避免误伤普通长数字
    add(/(?<!\d)\d{15}(?!\d)/g, 'IDCARD', 0.75, s => {
      const mm = +s.slice(8, 10), dd = +s.slice(10, 12);
      return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
    }, '15位老身份证');
    add(/(?<!\d)\d{16,19}(?!\d)/g, 'BANK', 0.95, luhnOk, 'Luhn 校验通过');
    add(/(?<![\dA-Za-z])\d{16,19}(?![\dA-Za-z])/g, 'BANK', 0.6, null, '长数字，疑似账号');
    // 带空格/短横分组的账号：6222 0202 0011 2345 678
    add(/(?<![\d-])(?:\d{4}[ -]){2,4}\d{1,7}(?![\d-])/g, 'BANK', 0.7,
      s => { const d = s.replace(/\D/g, ''); return d.length >= 15 && d.length <= 19; }, '分组账号');
    add(/(?<![0-9A-Z])[0-9A-HJ-NPQRTUWXY]{18}(?![0-9A-Z])/g, 'USCC', 0.95, usccOk, '校验位通过');
    add(/(?:统一社会信用代码|信用代码|纳税人识别号)\s*[:：]?\s*([0-9A-Z]{15,20})/g, 'USCC', 0.85, null, '语境');
    // 无后缀公司名：合作方为优鲜科技 / 供应商百佳供应链
    add(/(?:合作方为|合作方是|供应商为|供应商是|客户为|客户是|对方为|买方为|卖方为|甲方为|乙方为|交易对手为)\s*([\u4e00-\u9fa5]{2,6}(?:科技|供应链|贸易|实业|控股|电子|材料|机械|食品|医药|网络|数据|软件|物流|传媒|能源|环保|建设|装饰|咨询|服务))/g,
      'ORG', 0.78, null, '引导词+行业后缀');

    // 邮箱：必须限制本地部分长度。不加 {1,64} 的话，
    // 一段 5 万字的连续字母会让正则在每个位置贪婪匹配到结尾再逐字回退，O(n²) 卡死。
    add(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,10}(?![A-Za-z0-9-])/g,
      'EMAIL', 1, null, '');
    // 英文人名：必须有称谓或动词引导，否则英文名词满天飞
    add(/(?:Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|chaired by|attended by|prepared by|reviewed by|presented by|contact(?:ed)?|meeting with|signed by)\s*[:：]?\s+([A-Z][a-z]{1,12}(?:\s+[A-Z][a-z]{1,12}){1,2})/gi,
      'PERSON', 0.85, null, '英文语境');
    // 英文公司名：必须有公司后缀，否则英文大写词组太多
    add(/\b([A-Z][A-Za-z&.'-]{0,30}(?:\s+[A-Z][A-Za-z&.'-]{0,30}){0,5}\s+\((?:Hong Kong|HK|Singapore|Cayman|BVI|Shanghai|Beijing|China|Asia|US|UK)\)\s+(?:Ltd\.?|Limited|Inc\.?|LLC|Co\.,?\s*Ltd\.?|Company Limited|Pte\.?\s*Ltd\.?))/g,
      'ORG', 0.9, null, '英文公司（地区）');
    add(/\b((?:PT|CV|PT\.)\s+[A-Z]{2,30}(?:\s+[A-Z]{2,30}){1,5}(?:\s+(?:TBK|Tbk))?|[A-Z]{2,30}(?:\s+[A-Z]{2,30}){1,4}\s+(?:SDN\.?\s+BHD\.?|BHD|GMBH|GmbH|S\.?A\.?|N\.?V\.?|B\.?V\.?|AG|PLC|LLC|LTD|INC))\b/g,
      'ORG', 0.9, v => !/\b(?:REPORT|NOTES?|NOTICE|ACCOUNTS|STATEMENTS?|FINANCIAL|IMPORTANT|SHAREHOLDERS|ANNUAL|SUMMARY|APPENDIX|TABLE|CONTENTS|TO|OF|AND|FOR)\b/.test(v), '外国公司');
    add(/\b([A-Z][A-Za-z&.'-]{0,30}(?:\s+[A-Z][A-Za-z&.'-]{0,30}){0,4}\s+(?:Ltd\.?|Limited|Inc\.?|LLC|LLP|Corp\.?|Corporation|Group|Holdings|Partners|Capital|Fund|Bank|Securities))\b/g,
      'ORG', 0.85, null, '英文公司后缀');
    add(/(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g,
      'SECRET', 1, null, '');
    add(/(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key)["']?\s*[:=]\s*["']?([^\s,;，；"']{4,})/gi, 'SECRET', 0.9, secretPlausible, '');
    add(/(?<![\d.])(?:(?:10|127|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d{2,5})?(?![\d.])/g, 'IP', 0.85, null, '');
    add(/\b[A-Za-z0-9-]+\.(?:internal|local|corp|lan|intra)\b/g, 'IP', 0.8, null, '');
    add(/https?:\/\/[^\s，。、；）)"']+/g, 'URL', 0.9, null, '');
    // 裸域名：VPN 入口 vpn.crv-internal.com
    add(/(?:VPN|入口|域名|网址|登录地址|访问地址)\s*[:：]?\s*([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\.(?:com|cn|net|io|co|org|com\.cn))/gi,
      'URL', 0.85, null, '域名语境');
    add(/(?<![京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼])[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{5,6}/g,
      'PLATE', 0.9, null, '');
    // 城市 + 知名片区：上海张江 / 深圳南山 / 苏州工业园区
    add(/(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|宁波|青岛|长沙|郑州|合肥|福州|厦门|济南|沈阳|大连|无锡|佛山|东莞|珠海|中山)(?:市)?(?:张江|南山|前海|中关村|陆家嘴|亦庄|望京|金融城|科技园|高新区|经开区|自贸区|保税区|工业园区|开发区|软件园|科学城|办公室|办事处|分公司|总部)/g,
      'ADDR', 0.82, null, '城市+片区');
    add(/(?:(?:(?![省市区县镇乡街])[\u4e00-\u9fa5]){2,8}(?:省|市|区(?![域间别块分位])|县|镇|乡|街道)){1,4}[\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:路|街|(?<![渠赛轨频通管味知难报])道|巷|弄|大厦|大楼|广场|园区)(?:\s*[A-Za-z0-9\-]{1,8}\s*号)?(?:\s*(?:(?![省市区县路街道])[\u4e00-\u9fa5A-Za-z0-9]){1,10}(?:\s{0,2}\d{1,4})?\s{0,2}(?:号|层|楼|室|单元))*/g,
      'ADDR', 0.85, null, '含路名');
    // 只有"数字+号"才算门牌，"招银叁号"这类不算
    // 城市 + 知名片区：上海张江 / 深圳南山 / 苏州工业园区
    add(/(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|宁波|青岛|长沙|郑州|合肥|福州|厦门|济南|沈阳|大连|无锡|佛山|东莞|珠海|中山)(?:市)?(?:张江|南山|前海|中关村|陆家嘴|亦庄|望京|金融城|科技园|高新区|经开区|自贸区|保税区|工业园区|开发区|软件园|科学城|办公室|办事处|分公司|总部)/g,
      'ADDR', 0.82, null, '城市+片区');
    add(/(?:(?:(?![省市区县镇乡街])[\u4e00-\u9fa5]){2,8}(?:省|市|区(?![域间别块分位])|县|镇|乡|街道)){1,4}[\u4e00-\u9fa5A-Za-z0-9]{2,20}\d+\s*号(?:[\u4e00-\u9fa5A-Za-z0-9]{1,10}(?:层|楼|室|单元))*/g,
      'ADDR', 0.85, null, '含门牌号');

    /* ---- v2.0 格式类补充 ---- */
    // 国际电话：+852 9123 4567 / +1 (415) 555-0132；数字 8–15 位且不全相同
    add(/(?<![\w+])\+[1-9]\d{0,3}[\s-]?(?:\(\d{1,4}\)[\s-]?)?\d{2,5}(?:[\s-]?\d{2,5}){1,3}(?![\d])/g, 'PHONE', 0.92,
      v => { const d = v.replace(/\D/g, ''); return d.length >= 8 && d.length <= 15 && !/^(\d)\1+$/.test(d); }, '国际电话');
    // 公网 IPv4（原规则只认内网段）；排除版本号语境
    add(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?![\d.])/g, 'IP', 0.82, v => {
      const ip = v.split(':')[0];
      if (!ip.split('.').every(x => +x <= 255 && !(x.length > 1 && x[0] === '0'))) return false;
      return true;
    }, 'IPv4');
    // IPv6：要有数字且至少 4 个冒号或含 "::"，避免 std::vector、14:05:12
    add(/(?<![0-9A-Za-z:])[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?![0-9A-Za-z:])/g, 'IP', 0.85, ipv6Ok, 'IPv6');
    // IBAN（跨境交易收款账户）：mod-97 校验
    add(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, 'BANK', 0.95, ibanOk, 'IBAN 校验通过');
    // SWIFT / BIC：必须有语境，8 或 11 位
    add(/(?:SWIFT(?:\s*Code)?|BIC|Swift\s*Code|银行代码|SWIFT码)\s*[:：]?\s*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g, 'BANK', 0.9, null, 'SWIFT 语境');
    // 云厂商与常见平台密钥（补：Google AIza、GitHub PAT、阿里云 LTAI、腾讯云 AKID、Bearer）
    add(/(?:AIza[0-9A-Za-z_-]{35}|github_pat_[A-Za-z0-9_]{20,}|LTAI[A-Za-z0-9]{12,24}|AKID[A-Za-z0-9]{32})/g, 'SECRET', 1, null, '平台密钥');
    add(/\b[Bb]earer\s+([A-Za-z0-9._~+\/-]{16,}=*)/g, 'SECRET', 0.95, secretPlausible, 'Bearer');
    // 中文密码 / 口令 / 验证码：只换值，键名留着，AI 才看得懂上下文
    add(/(?:登录密码|初始密码|支付密码|交易密码|资金密码|密码|口令|验证码|动态码|PIN码?|pin码?)\s*(?:是|为)?\s*[:：=]?\s*([A-Za-z0-9!@#$%^&*._\-+=]{4,32})/g, 'SECRET', 0.9, secretPlausible, '中文密码');
    // 账号类（金融场景重点：证券账户、资金账号、股东账户）
    add(/(?:证券账户|证券账号|资金账号|资金账户|股东账户|股东代码|基金账户|期货账户|客户号|客户编号|QQ号?|微信号|微信|WeChat|工号|员工编号|员工号|会员号|会员卡号|学号|社保号|社保卡号|医保卡号|公积金账号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_-]{4,24})/g,
      'ACCOUNT', 0.9, v => !/^(?:\d)\1+$/.test(v), '账号语境');
    // 驾驶证 / 军官证 / 居住证 / 港澳台居民居住证
    add(/(?:驾驶证|驾照|军官证|士兵证|居住证|居民居住证)(?:号|号码|编号)?\s*[:：]?\s*([A-Za-z0-9]{8,20})/g, 'IDCARD', 0.88, null, '证件语境');
    // 出生日期（准标识符：和职务、学历组合就能反推是谁）
    add(/(?:出生日期|出生年月|生日|出生于|(?<![先学医后新卫考女])生于)\s*[:：]?\s*((?:19|20)\d{2}\s*(?:年|[-\/.])\s*\d{1,2}\s*(?:月|[-\/.])?(?:\s*\d{1,2}\s*日?)?)/g, 'BIRTH', 0.9, null, '出生日期');
    add(/((?:19|20)\d{2}\s*年(?:\s*\d{1,2}\s*月)?)(?=出生(?:[，,。；;）)\s]|于|$)|生人|生，)/g, 'BIRTH', 0.88, null, '某年出生');

    // 中文大写金额：人民币壹仟贰佰万元整
    add(/(?:人民币|RMB)?\s*([零壹贰叁肆伍陆柒捌玖拾佰仟万亿]{2,}(?:元|圆)(?:整)?)/g, 'MONEY', 0.9,
      s => /[拾佰仟万亿]/.test(s) || /人民币|RMB/.test(s), '大写金额');

    // 护照 / 港澳台通行证（必须有语境，避免误伤编号）
    add(/(?:护照|护照号|护照号码)\s*[:：]?\s*([A-Z]{1,2}\d{7,8})/g, 'IDCARD', 0.9, null, '语境');
    add(/(?:港澳?通行证|往来港澳通行证)(?:号|号码)?\s*[:：]?\s*([CW]\d{8})/g, 'IDCARD', 0.9, null, '语境');
    add(/(?:台胞证|台湾居民来往大陆通行证)(?:号|号码)?\s*[:：]?\s*(\d{8})/g, 'IDCARD', 0.9, null, '语境');

    // 股票代码：必须带交易所后缀，或紧邻"股票代码/证券代码"
    add(/\b(?:00|30|60|68|83|87|92)\d{4}\.(?:SZ|SH|BJ|sz|sh|bj)\b/g, 'TICKER', 0.95, null, '交易所后缀');
    add(/\b\d{4,5}\.(?:HK|hk)\b/g, 'TICKER', 0.95, null, '港股');
    add(/(?:NYSE|NASDAQ|Nasdaq|纳斯达克|纽交所|美股)\s*[:：]\s*([A-Z]{1,5})\b/g, 'TICKER', 0.9, null, '美股');
    // 公司名（股票代码）：蓝鲸新材（688236.SH）——代码前面的就是公司简称
    add(/([一-龥A-Za-z]{2,10})(?=\s*[（(]\s*(?:\d{6}\.(?:SH|SZ|BJ)|\d{4,5}\.HK|[A-Z]{1,5}\.(?:US|N|O))\s*[）)])/g, 'ORG', 0.95,
      v => !/^(?:公司|本公司|发行人|标的|其中|包括|如|例如|对标|可比公司)$/.test(v), '代码前名称');
    add(/(?:股票代码|证券代码|代码)\s*[:：]?\s*((?:00|30|60|68|83|87|92)\d{4})\b/g, 'TICKER', 0.85, null, '语境');

    // 合同 / 项目编号
    add(/(?:合同|项目|订单|招标|标书|立项|协议)(?:编号|号|编码|代码)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{3,30})/g,
      'CONTRACT', 0.85, null, '语境');

    // 发票号
    add(/发票(?:号|号码|代码)\s*[:：]?\s*(\d{8,20})/g, 'INVOICE', 0.85, null, '语境');

    // 账号类
    add(/(?:账号|帐户|账户|卡号|开户行账号)\s*[:：]?\s*(\d[\d\s-]{10,26}\d)/g, 'BANK', 0.9, null, '语境');

    // 英文实体（国际项目、外资客户）
    add(/\b[A-Z][A-Za-z&.'\- ]{1,32}?(?:Inc\.?|LLC|Ltd\.?|Limited|Corp\.?|Corporation|GmbH|S\.A\.|Pte\.?|Partners|Capital|Holdings|Group|Advisors|Securities)\b/g,
      'ORG', 0.8, null, '英文实体');

    // 行政区链 + 园区名：湖南省长沙市星沙经济开发区三一工业城 / 内蒙古自治区呼和浩特市和林格尔县盛乐…集聚区
    add(/(?:[\u4e00-\u9fa5]{2,6}(?:省|自治区))[\u4e00-\u9fa5]{2,6}?(?:市|自治州|盟|地区)(?:[\u4e00-\u9fa5]{1,6}?(?:区|县|旗|市))?[\u4e00-\u9fa5A-Za-z0-9]{2,24}?(?:开发区|工业园|产业园|工业城|集聚区|园区|新区|高新区|总部|基地|大厦|中心|厂区)/g,
      'ADDR', 0.85, null, '行政区链');
    // 版本号不是 IP：v1.2.3.4 / build 1.0.0.1 / 版本 2.3.1.0
    for (const sp of out) {
      if (sp.type !== 'IP' || sp.note !== 'IPv4') continue;
      const pre = text.slice(Math.max(0, sp.start - 12), sp.start);
      if (/[A-Za-z]$/.test(pre) || /(?:v|V|ver\.?|version|Version|build|Build|版本号?|固件|软件|内核)\s*[:：]?\s*$/.test(pre)) sp._drop = true;
    }
    for (let i = out.length - 1; i >= 0; i--) if (out[i]._drop) out.splice(i, 1);
    // 地址前缀收紧："总部搬到了南山区…""工厂位于江苏省…"——行政区前面的 2–8 字可能吞进动词短语
    for (const sp of out) {
      if (sp.type !== 'ADDR') continue;
      const head = sp.text.slice(0, 12);
      let cut = -1, mm;
      const cueRe = /位于|坐落于|搬到了|搬到|迁至|迁往|设在|设于|地址[:：]?|注册地[:：]?|寄到|送到|发往|在|于|到|是|了|的|为/g;
      while ((mm = cueRe.exec(head)) !== null) cut = mm.index + mm[0].length;
      if (cut > 0 && cut < sp.text.length - 4) {
        sp.start += cut; sp.text = sp.text.slice(cut);
      }
    }
    return refineGrouped(text, out);
  }

  // 带"语境前缀"的规则实际应只标记分组内容，这里按前缀长度修正
  const PREFIXED = [
    /^(?:股票代码|证券代码|代码)\s*[:：]?\s*/,
    /^(?:合同|项目|订单|招标|标书|立项|协议)(?:编号|号|编码|代码)\s*[:：]?\s*/,
    /^(?:发票)(?:号|号码|代码)\s*[:：]?\s*/,
    /^(?:账号|帐户|账户|卡号|开户行账号)\s*[:：]?\s*/,
    /^(?:统一社会信用代码|信用代码|纳税人识别号)\s*[:：]?\s*/,
    /^(?:护照号码|护照号|护照)\s*[:：]?\s*/,
    /^(?:港澳?通行证|往来港澳通行证|台胞证|台湾居民来往大陆通行证)(?:号|号码)?\s*[:：]?\s*/
  ];

  function refineGrouped(text, spans) {
    for (const sp of spans) {
      if (['TICKER', 'CONTRACT', 'INVOICE', 'BANK', 'USCC', 'IDCARD'].indexOf(sp.type) < 0) continue;
      if (sp.note !== '语境') continue;
      const seg = text.slice(sp.start, sp.end);
      for (const p of PREFIXED) {
        const m = seg.match(p);
        if (m && m[0].length < seg.length) {
          sp.start += m[0].length;
          sp.text = text.slice(sp.start, sp.end);
          break;
        }
      }
    }
    return spans;
  }

  /* ---------------- 检测器：组织名 ---------------- */
  const ORG_STOP_CHARS = new Set(
    ('的和与及对在是地得了等均也都还又并或而被将从由向为把让使于至约超近达共仅已拟就而且但则若因' +
     '其该本此各每某我你他它们这那有无未不很更最较太年月日季度个条项多家多两几所之同给').split('')
  );

  const ORG_LEAD = [
    '标的公司', '标的', '估值收购', '拟收购', '全资收购', '收购', '并购', '私有化', '分拆', '剥离',
    '作价', '对价', '斥资', '估值', '投资', '入股', '参股', '控股', '供应商', '客户', '竞争对手',
    '合作伙伴', '旗下', '所属', '包括', '例如', '比如', '其中', '以及', '预计', '达到', '规模',
    '市场', '行业', '主要', '核心', '头部', '一家', '多家', '几家', '该公司', '本公司', '公司'
  ];

  const ORG_SUFFIX_RE = new RegExp('(?:' + ORG_SUFFIX + ')', 'g');

  // 名字中间允许的短括注：地名、"集团 / 控股 / 中国 / 国际"等
  function parenOk(x) {
    if (!/^[一-龥A-Za-z]{1,8}$/.test(x)) return false;
    if (/^(?:集团|控股|中国|国际|香港|澳门|台湾|新加坡|开曼|亚洲|亚太|欧洲|美国|日本|韩国|BVI|HK|China|Asia|Group|Holdings)$/i.test(x)) return true;
    // 说明性的括注（仅供参考、单位、保守、以下简称、含税、未经审计……）不放行
    if (/参考|单位|保守|乐观|悲观|简称|以下|下称|原名|曾用|含税|如下|估算|测算|预测|万元|亿元|下同|同上|合并|母公司|口径|审计|调整|备考|说明|附注|详见|注释|暂定|待定|草案|修订|本期|上期|年度|季度/.test(x)) return false;
    if (/^(?:注|即|含|如|等|系|指|约|元|或|及|和|新|旧|华东|华南|华北|华中|西南|西北|东北)$/.test(x)) return false;
    // 地名：以省市区县旗州盟结尾，或 2–4 个字的专名
    if (/[省市区县旗州盟]$/.test(x)) return true;
    return x.length <= 4 && !COMMON_2.has(x);
  }
  function walkLeft(text, end, limit) {
    limit = limit || 30;
    let i = end;
    while (i > 0 && end - i < limit) {
      const c = text[i - 1];
      // 名字中间的短括注："茅台酒厂（集团）有限责任公司""汤姆逊多媒体（东莞）有限公司"
      if ((c === '）' || c === ')') && i < end + 1) {
        const op = text.lastIndexOf(c === '）' ? '（' : '(', i - 2);
        if (op > 0 && i - 1 - op >= 2 && i - 1 - op <= 7 && parenOk(text.slice(op + 1, i - 1)) && isCJK(text[op - 1])) {
          i = op; continue;
        }
        break;
      }
      // "多"只在"多家 / 多个"这类数量语境才算停止字（"汤姆逊多媒体"）
      if (c === '多' && !/[家个位名只种项年]/.test(text[i] || '')) { i--; continue; }
      if (/\d/.test(c) || /\s/.test(c) || ORG_STOP_CHARS.has(c)) break;
      // 左边已经是上一个名字的结尾（"…有限公司杭州云栖…"）：停
      if (i < end && text[i - 1] === '司' && text[i - 2] === '公') break;
      // 计量单位不能进公司名（8.5亿元估值收购…）；
      // 但"元禾""开元"里的"元"是名字的一部分，只有紧跟数字/亿/万时才算单位
      if (c === '亿' || c === '元') {
        const prev = i >= 2 ? text[i - 2] : '';
        if (/\d/.test(prev) || prev === '亿' || prev === '万') break;
      }
      if (c === '万') {
        const prev = i >= 2 ? text[i - 2] : '';
        if (/\d/.test(prev) || prev === ' ' || prev === '.') break;
      }
      if (!(isCJK(c) || isAsciiAlpha(c) || '·&'.indexOf(c) >= 0)) break;
      i--;
    }
    return i;
  }

  function detectOrgs(text, noWrap) {
    const out = [];
    ORG_SUFFIX_RE.lastIndex = 0;
    let m;
    while ((m = ORG_SUFFIX_RE.exec(text)) !== null) {
      const suf = m[0];
      const after = text[m.index + suf.length] || '';
      // "控股股东""控股比例""控股子公司" —— 是词组，不是公司名
      if (suf === '控股' && after && '股比权子母'.indexOf(after) >= 0) continue;
      if (suf === '集团' && after && '军'.indexOf(after) >= 0) continue;
      // 证券交易所 / 证券公司 / 基金公司 —— 机构类型，不是具体企业
      if ((suf === '证券' || suf === '基金' || suf === '保险' || suf === '银行') &&
          after && '交公业会'.indexOf(after) >= 0) continue;
      const start = walkLeft(text, m.index);
      let name = text.slice(start, m.index + suf.length);
      let changed = true;
      while (changed) {
        changed = false;
        for (const w of ORG_LEAD) {
          if (name.indexOf(w) === 0 && name.length - w.length >= 3) {
            name = name.slice(w.length);
            changed = true;
          }
        }
      }
      if (name.length < 4 || name.length > 30) continue;
      // 名称主体过长（>8 字）且后缀不是"有限公司"这类强后缀，多半是描述性短语
      const body = name.slice(0, name.length - suf.length);
      const strong = /^(股份有限公司|有限责任公司|有限公司|有限合伙|合伙企业)$/.test(suf);
      // 基金/合伙企业名字长是常态（国开制造业转型升级基金），上限放宽
      const longOk = /^(?:基金|合伙企业|有限合伙|资管|信托|银行|证券)$/.test(suf);
      if (!strong && !longOk && body.length > 8) continue;
      if (!strong && longOk && body.length > 14) continue;
      if (ORG_STOP.has(name) || name === suf) continue;
      if (/\d/.test(name)) continue;
      if (/(行业|产业|市场|板块|业务)$/.test(name)) continue;
      const st = text.indexOf(name, start);
      if (st < 0 || st + name.length > m.index + suf.length) continue;
      const conf = /^(有限公司|股份有限公司|有限责任公司|集团|有限合伙|合伙企业)$/.test(suf) ? 0.88 : 0.78;
      let end = st + name.length;
      // 吸收紧随其后的（有限合伙）（普通合伙）（中国）
      const tail = text.slice(end).match(/^[（(](?:有限合伙|普通合伙|中国)[）)]/);
      if (tail) { name += tail[0]; end += tail[0].length; }
      out.push(Span(st, end, 'ORG', name, conf, '后缀识别'));
    }
    // 相邻片段合并：中金资本 + 运营有限公司 → 中金资本运营有限公司
    out.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const sp of out) {
      const prev = merged[merged.length - 1];
      if (prev && sp.start === prev.end && (sp.end - prev.start) <= 26 && !/(?:公司|有限合伙)$/.test(prev.text)) {
        prev.end = sp.end;
        prev.text = text.slice(prev.start, prev.end);
        prev.conf = Math.max(prev.conf, sp.conf);
      } else {
        merged.push(sp);
      }
    }
    // 折行：名字在行尾断开（"欣通贸易有限⏎责任公司""基金股⏎份有限公司""有限公⏎司"）
    // 把换行两侧拼起来再识别一次；只认跨过换行、并以"有限公司"这类强后缀结尾的名字
    if (!noWrap) {
      let nl = -1;
      while ((nl = text.indexOf('\n', nl + 1)) >= 0) {
        const pc = text[nl - 1] || '', nc = text[nl + 1] || '';
        if (!/[一-龥）)]/.test(pc) || !/[一-龥（(]/.test(nc)) continue;
        // 往回找名字的开头：可以再跨过几个很短的行（窄表格里一个名字折成三四行）
        // 上一行太短（"设立""否""元"）多半是别的格子，不往回吞
        const lineLen = e => { let b = e; while (b > 0 && text[b - 1] !== '\n') b--; return e - b; };
        let st = nl, k = 0, seg = 0, hops = 0;
        while (st > 0 && k < 40) {
          const c = text[st - 1];
          if (/[一-龥（）()·]/.test(c)) { st--; k++; seg++; continue; }
          if (c === '\n' && hops < 3 && seg >= 3 && seg <= 12 && /[一-龥）)]/.test(text[st - 2] || '') && lineLen(st - 1) >= 3) { st--; hops++; seg = 0; continue; }
          break;
        }
        while (text[st] === '\n') st++;
        let en = nl + 1, k2 = 0;
        while (en < text.length && k2 < 12 && /[一-龥（）()]/.test(text[en])) { en++; k2++; }
        const map = [];
        let joined = '';
        for (let i = st; i < en; i++) { if (text[i] === '\n') continue; map.push(i); joined += text[i]; }
        const headLen = map.findIndex(i => i > nl);
        if (headLen < 1) continue;
        const hit = detectOrgs(joined, true).find(x => x.start < headLen && x.end > headLen &&
          /(?:有限公司|有限责任公司|股份有限公司|有限合伙|股份公司)$/.test(joined.slice(x.start, x.end)));
        if (!hit) continue;
        // 下一行自己就是一个完整的名字（"公司简介⏎星河远景科技股份有限公司"）：不跨行
        if (detectOrgs(joined.slice(headLen), true).some(x => x.start === 0 && x.end >= hit.end - headLen &&
          x.text.replace(/(?:股份有限公司|有限责任公司|有限公司|股份公司|有限合伙)$/, '').length >= 3)) continue;
        const body = joined.slice(hit.start, hit.end).replace(/(?:股份有限公司|有限责任公司|有限公司|有限合伙|股份公司)$/, '');
        if (!body || /^(?:董事|监事|高管|经理|员工|股东|公司|集团|子公司|分公司|控股|关联|其他|上述|以下|相关|下属|境外|境内|全资|本)+$/.test(body)) continue;
        let a2 = map[hit.start];
        const b2 = map[hit.end - 1] + 1;
        // 第一段是表格里别的格子（"适用""指""否""设立"……）：从下一行开始算名字
        for (let g = 0; g < 2; g++) {
          const fn = text.indexOf('\n', a2);
          if (fn < 0 || fn >= b2) break;
          if (/^(?:适用|不适用|指|是|否|无|有|升|降|设立|新设|注销|增资|减资|合计|其中|数量|金额|单位|元|万元|√|□|☑|■|是否|[\d.%，,、：:（）()]+)$/.test(text.slice(a2, fn).trim()) || /(?:关联方|董事|监事|经理|总监|股东|设立|收购|转让|投资|合伙人|代表)$/.test(text.slice(a2, fn).trim())) a2 = fn + 1;
          else break;
        }
        if (/^(?:（集团）)?(?:股份有限公司|有限责任公司|有限公司|股份公司|有限合伙(?:企业)?|责任公司|公司)$/.test(text.slice(a2, b2).replace(/\s/g, ''))) continue;   // 只剩后缀
        // 换行前那段要像名字：不含虚词动词，名字主体里不能再出现"公司"；后面接"居多 / 章程 / 类型"的是泛指
        const pre = text.slice(Math.max(a2, text.lastIndexOf('\n', nl - 1) + 1), nl);   // 只看名字所在这一行换行前的部分
        if (/的|须经|审议|是|了|着|等|应当|可以|设立|变更|整合|讨论|所称|基金|股东|控制人|关联方|董事|监事/.test(pre) || /公司/.test(joined.slice(hit.start, hit.end).replace(/(?:股份有限公司|有限责任公司|有限公司|股份公司)$/, ''))) continue;
        if (/^(?:类型|名称|形式|性质|组织形式|企业类型|性质为)$/.test(pre)) continue;
        if (/^(?:居多|为主|章程|类型|形式|性质|口径|等|之)/.test(text.slice(map[hit.end - 1] + 1, map[hit.end - 1] + 4))) continue;
        for (let i = merged.length - 1; i >= 0; i--) if (merged[i].start < b2 && merged[i].end > a2) merged.splice(i, 1);
        const xs = Span(a2, b2, 'ORG', text.slice(a2, b2), hit.conf, '跨行识别');
        xs.canon = xs.text.replace(/\s*\n\s*/g, '');      // 同一家公司不管在哪儿折行，都拿同一个代号
        merged.push(xs);
      }
    }
    merged.sort((x, y) => x.start - y.start);
    return merged;
  }

  /* ---------------- 检测器：项目代号 ---------------- */
  function detectProjects(text) {
    const out = [];
    let m;
    const re = /[\u4e00-\u9fa5A-Za-z0-9]{2,14}?(?:项目|专项)(?!经理|组|部|书|管)/g;
    while ((m = re.exec(text)) !== null) {
      const s = m[0];
      if (/^(?:项目|专项)$/.test(s)) continue;
      // 前缀不能以虚词/动词结尾（"以及项目"这类不是项目名）
      if (/[以及和与的了在为对由至到拓展]$/.test(s.slice(0, -2))) continue;
      // "已投项目14个""在建项目3个" 是数量描述，不是项目名
      if (/^(?:已投|在建|拟投|新设|现有|上述|以下|如下|全部|部分|各个|多个|若干|这些|那些|本|该|各)/.test(s)) continue;
      // 项目名太长多半吞了别的东西
      if (s.length > 14) continue;
      if (/^(某|该|本|这|那|一|多|几|各|此|新|老|大|小)/.test(s)) continue;
      // 描述性短语不是项目名：曾担任多个研究项目 / 参与重点项目
      if (/多个|多项|若干|担任|参与|负责|主持|承担|研究项目$|重点项目$|相关项目$|科研项目$|建设项目$|投资项目$/.test(s)) continue;
      out.push(Span(m.index, m.index + s.length, 'PROJECT', s, 0.7, '后缀识别'));
    }
    const re2 = /\b(?:Project|Proj\.?|Operation|Program)\s+([A-Z][A-Za-z0-9]{2,})/g;
    while ((m = re2.exec(text)) !== null) {
      out.push(Span(m.index, m.index + m[0].length, 'PROJECT', m[0], 0.85, '英文代号'));
    }
    return out;
  }

  /* 由全称推出常用简称："深圳市鹏城智造科技有限公司" → "鹏城智造科技""鹏城智造"
     用户导入的客户名单多是全称，正文里却常写简称；名单里的名字要做到一个不漏 */
  const ALIAS_SUFFIX = /(?:集团股份有限公司|集团有限公司|股份有限公司|有限责任公司|有限公司|股份公司|总公司|（集团）|\(集团\)|（有限合伙）|\(有限合伙\)|有限合伙|合伙企业|集团|控股|股份)$/;
  const ALIAS_REGION = /^(?:中国|(?:北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|台湾)(?:省|市|自治区)?|(?:广州|深圳|杭州|南京|成都|武汉|西安|苏州|宁波|青岛|长沙|郑州|合肥|福州|厦门|济南|沈阳|大连|无锡|佛山|东莞|珠海|中山|昆明|南宁|南昌|贵阳|太原|石家庄|哈尔滨|长春|兰州|乌鲁木齐|呼和浩特|海口|常州|温州|绍兴|嘉兴|金华|台州|泉州|烟台|潍坊|徐州|南通|扬州|镇江|惠州|江门|汕头|珠江)(?:市)?)/;
  const ALIAS_INDUSTRY = /(?:新能源|新材料|数字技术|网络技术|信息技术|科技|电子|数字|数码|软件|系统|互联|实业|投资|贸易|网络|信息|技术|发展|管理|咨询|服务|新材料|材料|医药|生物|智能|能源|物流|文化|传媒|置业|地产|建设|工程|设备|机械|制造|食品|农业|环保|化工|商业|商贸|国际|供应链)$/;
  // 字号是这些普通词时（"中国石油化工"去掉"中国"剩"石油化工"），推出来的简称会误伤行业说法、甚至撞上另一家公司
  const ALIAS_GENERIC = /^(?:发展|创新|国际|人寿|移动|石油|天然气|化工|国有|资产|经营|城市|建设|开发|金融|通信|电力|交通|铁路|航空|港务|保险|证券|信托|银行|投资|实业|贸易|中心|工业|商业|农业|科学|网络|电信|邮政|烟草|水务|燃气|环境|医疗|健康|教育|文化|旅游|体育|出版|广播|电视|新闻|人民|国家|中央|地方|总|股份|有限|集团|控股|科技|技术|服务|管理|咨询|物流|能源|材料|新材料|新能源|医药|生物|智能|电子|信息|置业|地产|工程|设备|机械|制造|食品|环保|供应链|港口|航运|汽车|钢铁|煤炭|有色|黄金|电网|核电|水电|风电|光伏)+$/;
  function aliasOk(a) {
    if (!a || a.length < 3) return false;
    if (ALIAS_GENERIC.test(a.replace(ALIAS_REGION, ''))) return false;
    if (ALIAS_GENERIC.test(a)) return false;
    return true;
  }
  function deriveAliases(full) {
    const out = [];
    let core = String(full || '').trim().replace(/[（(](?:中国|香港|深圳|上海|北京|广州|集团|控股)[）)]/g, '');
    if (!ALIAS_SUFFIX.test(core) && !/(?:公司|集团)$/.test(core)) return out;
    for (let k = 0; k < 3 && ALIAS_SUFFIX.test(core); k++) core = core.replace(ALIAS_SUFFIX, '');
    core = core.replace(/[（(][^）)]{1,8}[）)]$/, '');                       // 去掉末尾括注"（深圳）"
    const noRegion = core.replace(ALIAS_REGION, '');
    // 字号（去掉地名和行业词以后剩下的部分）不足两个字：名字本身就是泛称（"北京科技发展有限公司"），不推简称
    let brand = noRegion;
    for (let k = 0; k < 4 && ALIAS_INDUSTRY.test(brand); k++) brand = brand.replace(ALIAS_INDUSTRY, '');
    if (brand.length < 2 || ALIAS_REGION.test(brand + '市')) return out;
    if (ALIAS_GENERIC.test(brand)) return out;
    const add = x => { if (x && x.length >= 3 && x.length <= 12 && x !== full && out.indexOf(x) < 0 && nameRemainderOk(x) && !COMMON_2.has(x) && aliasOk(x)) out.push(x); };
    add(core);
    add(noRegion);
    // "中国XX"：中国是字号的一部分，不再砍行业词（"中国石油化工"砍成"中国石油"就成了另一家公司）
    if (/^中国/.test(core)) return out;
    for (const base of [core, noRegion]) {
      let b = base;
      for (let k = 0; k < 2 && ALIAS_INDUSTRY.test(b); k++) { b = b.replace(ALIAS_INDUSTRY, ''); add(b); }
    }
    return out;
  }

  /* 词库匹配：按首字分桶，一遍扫完（词库上千、单元格上万时，逐词 indexOf 太慢） */
  const dictIdx = new WeakMap();
  const dictAliasCache = new WeakMap();
  function dictFind(list, text, type, note, minLen) {
    const out = [];
    if (!list || !list.length || !text) return out;
    let ix = dictIdx.get(list);
    if (!ix || ix.n !== list.length) {
      const b = new Map();
      for (const w of list) {
        if (!w || w.length < (minLen || 1)) continue;
        if (!b.has(w[0])) b.set(w[0], []);
        b.get(w[0]).push(w);
      }
      ix = { n: list.length, b: b };
      dictIdx.set(list, ix);
    }
    if (list.length < 8) {                // 词少时直接 indexOf 更快
      for (const w of list) {
        if (!w || w.length < (minLen || 1)) continue;
        let i = -1;
        while ((i = text.indexOf(w, i + 1)) >= 0) out.push(Span(i, i + w.length, type, w, 1, note));
      }
      return out;
    }
    for (let i = 0; i < text.length; i++) {
      const ws = ix.b.get(text[i]);
      if (!ws) continue;
      for (const w of ws) if (text.startsWith(w, i)) out.push(Span(i, i + w.length, type, w, 1, note));
    }
    return out;
  }

  /* ---------------- 检测器：人名 ---------------- */
  function detectPersons(text, dict) {
    const out = dictFind((dict && dict.PERSON) || [], text, 'PERSON', '词库', 2);

    let m;
    // 1) 角色引导
    const r1 = new RegExp('(?:' + ROLE_CUE + ')\\s*(?:[（(][^）)]{1,8}[）)])?\\s*(?:兼\\s*[A-Za-z]{2,8}\\s*)?\\s*[:：]?\\s*([\\u4e00-\\u9fa5]{2,3})', 'g');
    while ((m = r1.exec(text)) !== null) {
      const cand = m[1];
      if (!looksLikeName(cand)) continue;
      const st = m.index + m[0].length - cand.length;
      if (cutInsideCompound(text, st, cand)) continue;
      out.push(Span(st, st + cand.length, 'PERSON', cand, 0.9, '角色词'));
    }
    // 2) 称谓后缀
    const r2 = new RegExp('([\\u4e00-\\u9fa5]{2,3})(?=' + TITLE_SUFFIX + ')', 'g');
    while ((m = r2.exec(text)) !== null) {
      if (!looksLikeName(m[1])) continue;
      if (cutInsideCompound(text, m.index, m[1])) continue;
      out.push(Span(m.index, m.index + m[1].length, 'PERSON', m[1], 0.88, '称谓'));
    }
    // 2.5) 邮件/消息称呼：李娜您好 / 张总您好
    const r25 = /(?:^|[\n。；，\s])([\u4e00-\u9fa5]{2,3})(?:您好|你好|好[，,：:])/g;
    while ((m = r25.exec(text)) !== null) {
      if (!looksLikeName(m[1])) continue;
      const st = m.index + m[0].length - m[1].length - 2;
      out.push(Span(st, st + m[1].length, 'PERSON', m[1], 0.8, '称呼'));
    }

    // 3) 括号别名：张伟（张总）
    const r3 = /([\u4e00-\u9fa5]{2,3})[（(][\u4e00-\u9fa5]{1,3}(?:总|经理|总监|先生|女士)[）)]/g;
    while ((m = r3.exec(text)) !== null) {
      if (!looksLikeName(m[1])) continue;
      out.push(Span(m.index, m.index + m[0].length, 'PERSON', m[1], 0.85, '括号别名'));
    }
    // 4) 名单枚举
    const r4 = /(?:参会|出席|参加|列席|与会|名单|成员|访谈|面谈|对接|汇报对象|项目组|团队|联系人|干系人|stakeholders)[人员对象]*\s*[:：]\s*([^\n。；]{2,80})/g;
    while ((m = r4.exec(text)) !== null) {
      const seg = m[1];
      const base = m.index + m[0].length - seg.length;
      const rn = /[\u4e00-\u9fa5]{2,3}/g;
      let mm;
      while ((mm = rn.exec(seg)) !== null) {
        if (!looksLikeName(mm[0])) continue;
        const st = base + mm.index;
        out.push(Span(st, st + mm[0].length, 'PERSON', mm[0], 0.88, '名单'));
      }
    }
    // 5) 后置动词
    const r5 = /([\u4e00-\u9fa5]{2,3})(?=负责|牵头|主导|跟进|对接|汇报|签字|审批|确认|提供|反馈|统筹|表示|认为|指出|透露|介绍|回应|告诉|强调|预计|分析|坦言|直言|回忆|补充|主持|出席|参加|列席|发言|提问|答复|建议|提出)/g;
    while ((m = r5.exec(text)) !== null) {
      if (!looksLikeName(m[1])) continue;
      out.push(Span(m.index, m.index + m[1].length, 'PERSON', m[1], 0.72, '后置动词'));
    }
    // 6) 语境动词
    const r6 = new RegExp('(?:' + PERSON_PREV + ')([\\u4e00-\\u9fa5]{2,3})(?![\\u4e00-\\u9fa5])', 'g');
    while ((m = r6.exec(text)) !== null) {
      const cand = m[1];
      if (!looksLikeName(cand)) continue;
      const st = m.index + m[0].length - cand.length;
      out.push(Span(st, st + cand.length, 'PERSON', cand, 0.75, '语境'));
    }

    /* ---- v2.0：真实文体里的人名写法（年报董监高、尽调、纪要、邮件） ---- */
    // 7) 强引导 + 名单：独立董事：冯晓光、蒋一帆 / 实际控制人为邓志远 / 分别为：戚家豪（首席科学家）、施雨桐
    const r7 = new RegExp('(?:' + STRONG_CUE + ')(?:分别为|分别是|包括|依次为|为|是|系|由)?\\s*[:：]?\\s*', 'g');
    while ((m = r7.exec(text)) !== null) {
      let pos = m.index + m[0].length, k = 0;
      while (k < 10) {
        const nm = pickName(text, pos, true);
        if (!nm) break;
        out.push(Span(pos, pos + nm.length, 'PERSON', nm, k === 0 ? 0.9 : 0.88, '强引导'));
        k++;
        pos += nm.length;
        // 名字后的括注：（首席科学家）/（转法务部）
        const par = /^[（(][^）)\n]{1,12}[）)]/.exec(text.slice(pos));
        if (par) pos += par[0].length;
        const sep = /^\s*(?:、|，|,|和|及|与|\/)\s*/.exec(text.slice(pos));
        if (!sep) break;
        pos += sep[0].length;
      }
    }
    // 8) 由X担任 / 由X主持
    const r8 = new RegExp('由(' + NAME_SRC + ')(?=担任|出任|兼任|主持|召集|牵头|负责|签署|代表)', 'g');
    while ((m = r8.exec(text)) !== null) {
      const st = m.index + 1, nm = pickName(text, st, true);
      if (nm) out.push(Span(st, st + nm.length, 'PERSON', nm, 0.9, '由…担任'));
    }
    // 9) 履历开头：欧阳楚英，1971年出生，中国国籍 / 赵敏，女，汉族
    const r9 = new RegExp('(?:^|[\\n。；;])\\s*(' + NAME_SRC + ')[，,]\\s*(?=男|女|(?:19|20)\\d{2}\\s*年|中国国籍|汉族|硕士|博士|本科|大专|研究生|高级|注册会计师|教授|经济师|会计师|工程师|律师)', 'g');
    while ((m = r9.exec(text)) !== null) {
      const nm = m[1], st = m.index + m[0].indexOf(nm);
      if (looksLikeName(nm, true)) out.push(Span(st, st + nm.length, 'PERSON', nm, 0.92, '履历'));
    }
    // 10) 履历动词：司马文涛曾任职于 / 现任 / 历任 / 毕业于
    const r10 = new RegExp('(' + NAME_SRC + ')(?=曾任|现任|历任|曾就职|曾在|毕业于|任职于|获聘|当选|辞去|辞任|兼任|出任|直接持有|间接持有|持有公司|通过[^。；\n]{2,40}持有)', 'g');
    while ((m = r10.exec(text)) !== null) {
      const holdCtx = /^[\u4e00-\u9fa5]{0,4}(?:通过|直接持有|间接持有|持有公司)/.test(text.slice(m.index + 2, m.index + 10));
      const nm = pickName(text, m.index, holdCtx);   // 只有持股语境才认常用字姓（"访谈对象曾任"不再误认）
      if (nm && !cutInsideCompound(text, m.index, nm)) out.push(Span(m.index, m.index + nm.length, 'PERSON', nm, 0.88, '履历动词'));
    }
    // 11) 姓 + 职务简称：王总、张总监、李总工、刘董、小刘、老陈
    const r11 = new RegExp('(?:[老小](?:' + SURNAME_CLASS_SAFE + ')|(?:' + SURNAME_CLASS + ')(?:总监|总工|总|董|工|经理|律师|老师|行长|主任|先生|女士))(?=' + NAME_FOLLOW + ')', 'g');
    while ((m = r11.exec(text)) !== null) {
      const pc = text[m.index - 1] || '';
      if (/\d/.test(pc)) continue;                       // 40小时 / 3小组
      if (pc && /[\u4e00-\u9fa5]/.test(pc) && SHORT_PREV.indexOf(pc) < 0) continue;
      out.push(Span(m.index, m.index + m[0].length, 'PERSON', m[0], 0.82, '姓+称谓'));
    }
    // 12) 邮件称呼和签名：Hi 思远 / Dear Mr. Tanaka / Best, Grace Lin / CFO Linda Wu
    const r12 = /(?:\b(?:Hi|Hello|Dear|Hey)|(?<![\u4e00-\u9fa5])致|亲爱的)\s*[,，]?\s*([\u4e00-\u9fa5]{2,3})(?=[，,：:！!\s]|$)/g;
    while ((m = r12.exec(text)) !== null) {
      const st = m.index + m[0].length - m[1].length;
      if (!NAME_BAD_PARTS.test(m[1])) out.push(Span(st, st + m[1].length, 'PERSON', m[1], 0.88, '称呼'));
    }
    const r13 = /\b(?:(?:(?:Hi|Hello|Dear|Hey)\s+(?:(?:Mr|Ms|Mrs|Dr|Prof)\.?\s+)?|(?:Mr|Ms|Mrs|Dr|Prof)\.?\s+)((?:Mc|O')?[A-Z][a-z]{1,20}(?:[-'][A-Z]?[a-z]{1,20})?(?:\s+(?:Mc|O')?[A-Z][a-z]{1,20}(?:[-'][A-Z]?[a-z]{1,20})?){0,2})|(?:CEO|CFO|COO|CTO|CIO|VP|MD|SVP|EVP|Partner|Director|Analyst|Associate|Principal)\s+((?:Mc|O')?[A-Z][a-z]{1,20}(?:\s+(?:Mc|O')?[A-Z][a-z']{1,20}){1,2}))/g;
    while ((m = r13.exec(text)) !== null) {
      const nm = m[1] || m[2];
      if (EN_NOT_NAME.test(nm)) continue;
      const st = m.index + m[0].lastIndexOf(nm);
      out.push(Span(st, st + nm.length, 'PERSON', nm, 0.88, '英文称呼'));
    }
    const r14 = /(?:^|\n|[.。!！]\s*)(?:Best(?: regards)?|Regards|Kind regards|Thanks|Thank you|Cheers|Sincerely|BR)\s*[,，]?\s*\n?\s*((?:Mc|O')?[A-Z][a-z]{1,20}(?:\s+(?:Mc|O')?[A-Z][a-z']{1,20}){0,2})(?![a-z])/g;
    while ((m = r14.exec(text)) !== null) {
      if (EN_NOT_NAME.test(m[1])) continue;
      const st = m.index + m[0].length - m[1].length;
      out.push(Span(st, st + m[1].length, 'PERSON', m[1], 0.88, '邮件签名'));
    }
    // 15) 表格行：李西廷 男 73 董事长 / 2 曹成虎 董事、总经理 / 王 莉 董事 女（两字名常被补空格）
    const r15 = new RegExp('(?:^|\\n)[ \\t]*(?:\\d{1,3}[ \\t]+|\\d{1,3}[、.）)][ \\t]*)?((?:' + SURNAME_CLASS + ')[ \\u3000]?[\\u4e00-\\u9fa5]{1,2}|(?:' + COMPOUND_SRC + ')[\\u4e00-\\u9fa5]{1,2})(?=[ \\t]+(?:男|女|\\d{2}[ \\t]|董事|监事|独立|总经理|副总|总裁|副总裁|财务|董事会|职工|现任|离任|执行|非执行|首席|核心|[\\u4e00-\\u9fa5]{2,30}(?:有限公司|集团|大学|研究院)))', 'g');
    while ((m = r15.exec(text)) !== null) {
      const nm = m[1], st = m.index + m[0].length - nm.length;
      const bare = nm.replace(/[ \u3000]/g, '');
      if (bare.length < 2 || bare.length > 4 || NAME_BAD_PARTS.test(bare)) continue;
      out.push(Span(st, st + nm.length, 'PERSON', nm, 0.9, '表格行'));
    }
    // 16) 邮件头：From: 陈思远 <…> / To: 周凯 / 发件人：Susan Liu
    const r16 = /(?:^|\n)[ \t]*(?:From|To|Cc|Bcc|发件人|收件人|抄送)[ \t]*[:：][ \t]*([^\n<]{2,60})/gi;
    while ((m = r16.exec(text)) !== null) {
      const seg = m[1], base = m.index + m[0].length - seg.length;
      const re2 = /[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z']{1,20}){0,2}|[\u4e00-\u9fa5]{2,4}/g;
      let mm;
      while ((mm = re2.exec(seg)) !== null) {
        const w = mm[0];
        if (/[\u4e00-\u9fa5]/.test(w) && !looksLikeName(w, true) && COMPOUND_PAIRS.indexOf(w.slice(0, 2)) < 0) continue;
        if (EN_NOT_NAME.test(w)) continue;
        out.push(Span(base + mm.index, base + mm.index + w.length, 'PERSON', w, 0.9, '邮件头'));
      }
    }
    // 17) 签名行：李晓蕾 | 投资经理 / 张伟⏎合伙人
    const r17 = new RegExp('(?:^|\\n)[ \\t]*(' + NAME_SRC + ')[ \\t]*(?:[|｜/·]|\\n)[ \\t]*(?:' + TITLE_WORDS + ')', 'g');
    while ((m = r17.exec(text)) !== null) {
      const nm = m[1], st = m.index + m[0].indexOf(nm);
      if (looksLikeName(nm, true) || COMPOUND_PAIRS.indexOf(nm.slice(0, 2)) >= 0) out.push(Span(st, st + nm.length, 'PERSON', nm, 0.9, '签名行'));
    }
    // 18) 复姓 + 名 + 常见后续：尉迟建国先生 / 东方宇轩任董事会秘书 / 皇甫嵩为独立董事
    const r18 = new RegExp('(?:' + COMPOUND_SRC + ')(?=[\\u4e00-\\u9fa5])', 'g');
    while ((m = r18.exec(text)) !== null) {
      const nm = pickName(text, m.index, true);
      if (nm && nm.length >= 3) out.push(Span(m.index, m.index + nm.length, 'PERSON', nm, 0.9, '复姓'));
    }
    // 19) 中文引导 + 英文名：反对人：Susan Liu / 联系人: Kevin Zhang / 与 Linda 和 Mark 对齐
    const r19 = /(?:人|代表|对接|联系)\s*[:：]\s*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z']{1,20}){0,2})/g;
    while ((m = r19.exec(text)) !== null) {
      if (EN_NOT_NAME.test(m[1])) continue;
      const st = m.index + m[0].length - m[1].length;
      out.push(Span(st, st + m[1].length, 'PERSON', m[1], 0.88, '英文名'));
    }
    const r20 = /(?<=[与和跟找问让请同给@、])\s*([A-Z][a-z]{2,12})(?=\s*(?:和|与|、|，|,|说|提|对齐|确认|沟通|讨论|负责|一起|聊|开会|$))/g;
    while ((m = r20.exec(text)) !== null) {
      if (EN_NOT_NAME.test(m[1]) || EN_COMMON.test(m[1])) continue;
      const st = m.index + m[0].length - m[1].length;
      out.push(Span(st, st + m[1].length, 'PERSON', m[1], 0.8, '英文单名'));
    }
    // "卖方研报认为""投资方普遍认为"：前一个字和"方"连成"买方 / 卖方 / 投资方"，不是姓方的人
    for (let i = out.length - 1; i >= 0; i--) {
      const sp = out[i];
      if (sp.text[0] === '方' && /[买卖甲乙丙丁双各对资让租托包承委出受]/.test(text[sp.start - 1] || '')) out.splice(i, 1);
    }
    // 三字名的第三个字和后面连成常用动词（"张伟负责""李明表示"）：其实是两字名
    for (const sp of out) {
      if (sp.end - sp.start !== 3 || !/^[\u4e00-\u9fa5]{3}$/.test(sp.text)) continue;
      if (/^(?:负责|表示|认为|提出|说明|带领|要求|指出|介绍|确认|同意|反馈|汇报|主持|参加|出席|签署|担任|分管|协助|牵头|对接|联系|告知|回复|补充|强调|透露|建议)/.test(text.slice(sp.end - 1, sp.end + 1)) &&
        looksLikeName(sp.text.slice(0, 2), true)) {
        sp.end -= 1; sp.text = sp.text.slice(0, 2);
      }
    }
    return out;
  }

  /* ---- v2.0 人名工具 ---- */
  const TITLE_WORDS = '投资经理|投资总监|合伙人|董事总经理|执行董事|副总裁|总裁|总经理|经理|总监|分析师|研究员|顾问|律师|会计师|主管|助理|VP|MD|ED|Partner|Director|Analyst|Associate|Manager';
  const EN_COMMON = /^(?:Excel|Word|Wind|Choice|Bloomberg|Python|Google|Apple|Microsoft|Amazon|Tesla|Meta|OpenAI|Claude|ChatGPT|Kimi|Zoom|Teams|Slack|Email|Mail|Deck|Memo|Model|Data|Note|Notes|Update|Action|Items|Draft|Final)$/;
  const SURNAME_CLASS = (function () {
    const singles = (SURNAMES + SURNAMES_AMBIG).replace(/欧阳|司马|上官|诸葛|东方|尉迟|皇甫/g, '');
    return '[' + Array.from(new Set(singles.split(''))).join('') + ']';
  })();
  const SURNAME_CLASS_SAFE = '[' + Array.from(new Set(SURNAMES.replace(/欧阳|司马|上官|诸葛|东方|尉迟|皇甫/g, '').split(''))).join('') + ']';
  const COMPOUND_SRC = COMPOUND_PAIRS.join('|');
  // 候选：复姓 + 1–2 字，或单字 + 1–2 字；长度由 pickName 按后文判定
  const NAME_SRC = '(?:' + COMPOUND_SRC + ')[\\u4e00-\\u9fa5]{1,2}|[\\u4e00-\\u9fa5]{2,3}';
  // 名字之后通常紧跟的字或词：标点、称谓、动词、连词
  const NAME_FOLLOW = '[，。、；：:,;！!？?）)（(\\s]|$|先生|女士|小姐|担任|出任|兼任|表示|认为|说|讲|补充|主持|召集|负责|汇报|确认|同意|反对|曾|现任|历任|任|为|是|与|和|及|等|兼|已|于|在|因|的|将|对|也|则|作为|通过|辞|签|提供|反馈|发言|提出|指出|透露|介绍|牵头|对接|跟进|存在|持有|直接|间接|系|之|手机|电话|邮箱|微信|周[一二三四五六日]|今天|明天|下周|上周|这|那|他|她|我|你|们|要|会|还|就|都|又|只|再|去|来|到|把|被|让|给|跟|问|看|做|想|觉得|一起|也是';
  const NAME_FOLLOW_RE = new RegExp('^(?:' + NAME_FOLLOW + ')');
  const SHORT_PREV = '的由与和向给请找跟同及、，。：:（(被让叫问；;对是为把\n ';
  const STRONG_CUE = [
    '监事会主席', '职工代表监事', '非独立董事', '独立董事', '董事会秘书', '高级管理人员', '核心技术人员',
    '法定代表人', '法人代表', '实际控制人', '实控人', '控股股东', '创始人', '联合创始人',
    '董事长', '副董事长', '总经理', '副总经理', '财务总监', '财务负责人', '董秘', '总裁', '副总裁',
    '保荐代表人', '项目协办人', '签字会计师', '签字律师', '经办律师', '经办人', '签字人',
    '联系人', '收件人', '寄件人', '收货人', '抄送', '记录人', '记录', '主持人', '召集人', '参会人员', '参会人', '出席人员',
    '原告', '被告', '申请人', '被申请人', '第三人', '借款人', '出借人', '担保人', '保证人', '债务人', '债权人', '自然人', '受益人',
    '配偶', '之子', '之女', '其妻', '其夫', '老板', '老总', '一把手',
    '负责人', '项目经理', '项目负责人', '合伙人', '分析师', '研究员', '律师', '会计师',
    '分别为', '分别是', '名单如下', '成员为', '成员包括', '成员有',
    '股东还包括', '股东包括', '人员包括', '团队（', '授权代表', '委托代理人', '首席代表',
    '纪要整理', '整理人', '整理', '撰写人', '起草人', '编制人', '审核人', '复核人', '批准人',
    '厂长', '店长', '行长', '院长', '校长', '处长', '科长', '局长', '部长', '主任', '组长', '所长', '会长', '秘书长',
    '投资经理', '投资总监', '销售总监', '运营总监', '技术总监', '财务经理', '总监', '经理', '主管'
  ].sort((a, b) => b.length - a.length).join('|');
  const EN_NOT_NAME = /^(?:Mr|Ms|Mrs|Dr|Prof|Team|All|Sir|Madam|Board|Committee|Company|Group|Partners|Capital|Fund|The|This|That|Please|Thanks|Best|Regards|Report|Meeting|Project|Investment|Investor|Investors|Management|Shareholders|Client|Customer)\b/;

  // 从 pos 开始取一个人名：先试 3/4 字，再试 2 字，以"后面紧跟的是不是名字后常见的字词"为准
  function pickName(text, pos, strong) {
    const two = text.slice(pos, pos + 2);
    const comp = COMPOUND_PAIRS.indexOf(two) >= 0;
    const lens = comp ? [4, 3] : [3, 2];
    for (const L of lens) {
      const c = text.slice(pos, pos + L);
      if (c.length < L || !/^[\u4e00-\u9fa5]+$/.test(c)) continue;
      // 第三个字和后面的字连成常用动词（"张伟负责""李明表示"）：名字只有两个字
      if (L === 3 && !comp && /^(?:负责|表示|认为|提出|说明|带领|要求|指出|介绍|确认|同意|反馈|汇报|主持|参加|出席|签署|担任|分管|协助|牵头|对接|联系|告知|回复|补充|强调|透露|建议)/.test(text.slice(pos + 2, pos + 4))) continue;
      if (!comp && !looksLikeName(c, strong)) continue;
      if (comp && (NAME_BAD_PARTS.test(c) || c.length < 3)) continue;
      if (!NAME_FOLLOW_RE.test(text.slice(pos + L, pos + L + 4))) continue;
      return c;
    }
    // 强引导后（"老板黄建国理念不合"）：后文判不出来时按 3 字名兜底，中文姓名以 3 字为主
    if (strong && !comp && SURNAMES.indexOf(text[pos]) >= 0) {
      const c = text.slice(pos, pos + 3);
      if (c.length === 3 && /^[\u4e00-\u9fa5]+$/.test(c) && looksLikeName(c, true)) return c;
    }
    return null;
  }

  /* ---------------- 检测器：金额 ---------------- */
  const MONEY_RE = new RegExp(
    '(?<cur>人民币|RMB|CNY|USD|美元|美金|港币|HKD|欧元|EUR|¥|￥|\\$|€)?\\s{0,3}' +
    '(?<num>\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s{0,3}' +
    '(?<unit>十亿元|十亿|亿元|万元|千万元|百万元|百万|千万|亿|万|千元|元|块|million|billion|mn|bn|M|B|K|k)?',
    'g'
  );

  const UNIT_MULT = {
    '十亿元': 1e9, '十亿': 1e9, '亿元': 1e8, '亿': 1e8, '千万元': 1e7, '千万': 1e7,
    '百万元': 1e6, '百万': 1e6, '万元': 1e4, '万': 1e4, '千元': 1e3,
    '元': 1, '块': 1, 'million': 1e6, 'billion': 1e9, 'mn': 1e6, 'bn': 1e9,
    'M': 1e6, 'B': 1e9, 'K': 1e3, 'k': 1e3
  };

  // 内部代号：代号"凤凰" / 项目代号 CRV-2026 / Code Name: Phoenix
  // 用捕获组定位，避免把"代号"这个引导词本身也替换掉
  const CODENAME_RE = /(?:内部代号|项目代号|代号|Code\s*Name)\s*[:：]?\s*["'「『]?([A-Za-z0-9\-\u4e00-\u9fa5]{2,14})["'」』]?/g;

  // 报告编号 / 公告编号：只替换编号本身，别把"公告编号："也吃掉
  const DOCNO_RE = /(?:报告编号|公告编号|文件编号|文号|编号|No\.?|Ref\.?)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_\/]{4,24})/g;

  function detectDocNo(text) {
    const out = [];
    DOCNO_RE.lastIndex = 0;
    let m;
    while ((m = DOCNO_RE.exec(text)) !== null) {
      const v = m[1];
      const st = m.index + m[0].lastIndexOf(v);
      out.push(Span(st, st + v.length, 'CONTRACT', v, 0.85, '编号语境'));
    }
    return out;
  }

  function detectCodename(text) {
    const out = [];
    CODENAME_RE.lastIndex = 0;
    let m;
    while ((m = CODENAME_RE.exec(text)) !== null) {
      const v = m[1];
      if (!v || /^(?:为|是|已|在|的|项目|专项)$/.test(v)) continue;
      // 纯中文两字且是普通词的不认（"代号为"已被上面挡掉）
      if (/^[\u4e00-\u9fa5]{2}$/.test(v) && /^(?:项目|专项|计划|方案|工作|任务)$/.test(v)) continue;
      const st = m.index + m[0].indexOf(v);
      out.push(Span(st, st + v.length, 'PROJECT', v, 0.82, '代号引导'));
    }
    return out;
  }

  // "合作方为优鲜科技与百佳供应链" —— 引导词后面常跟一串，逐个提取
  const ORG_LIST_LEAD = /(?:合作方为|合作方是|供应商为|供应商是|客户为|客户是|对方为|买方为|卖方为|甲方为|乙方为|交易对手为|对手方为|标的为|标的公司为|投资方为|领投方为|跟投方为|外包给|委托给|卖给|供货给|采购自|代工方为|经销商为|渠道商为)\s*/g;
  const ORG_BODY = /([\u4e00-\u9fa5]{2,6}(?:科技|供应链|贸易|实业|控股|电子|材料|机械|食品|医药|网络|数据|软件|物流|传媒|能源|环保|建设|装饰|咨询|服务|投资|资本|基金|生物|医疗|光电|新材|化工|资源|集团|股份|半导体|智能|汽车|地产|置业|信息|电气|重工|健康|新能源|金融|租赁|保理|创投|制造|商贸|精密|仪器|装备|化学|制药|药业|器械))/y;

  function detectOrgList(text) {
    const out = [];
    ORG_LIST_LEAD.lastIndex = 0;
    let m;
    while ((m = ORG_LIST_LEAD.exec(text)) !== null) {
      let pos = m.index + m[0].length;
      for (let k = 0; k < 6; k++) {
        ORG_BODY.lastIndex = pos;
        const g = ORG_BODY.exec(text);
        if (!g) break;
        if (!orgItemOk(g[1])) break;
        out.push(Span(pos, pos + g[1].length, 'ORG', g[1], 0.78, '列举'));
        pos += g[1].length;
        const sep = text.slice(pos, pos + 3).match(/^\s*(?:与|和|、|及)\s*/);
        if (!sep) break;
        pos += sep[0].length;
      }
    }
    return out;
  }


  /* ================= 自定义规则 =================
     词库只能覆盖"名字"，
     覆盖不了"编号格式"。咨询公司常有内部项目号、工号、合同号，
     格式固定，用正则一条就能覆盖。
  */

  function detectCustomRules(text, rules) {
    const out = [];
    if (!rules || !rules.length) return out;
    for (const r of rules) {
      if (!r || !r.pattern) continue;
      if (r.slow || unsafeRegex(r.pattern) || !Object.prototype.hasOwnProperty.call(TYPES, r.type)) continue;   // 旧版本存下的危险规则也不跑
      let re;
      try {
        re = new RegExp(r.pattern, r.flags || 'g');
      } catch (e) { continue; }   // 用户写的正则可能有语法错，跳过不崩
      let m, n = 0;
      const t0 = Date.now();
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        // 兜底：某条规则在这段文字上跑了 300 毫秒以上，本次会话里停用它（没拦住的危险写法）
        if (Date.now() - t0 > 300) { r.slow = true; break; }
        const val = (m[1] !== undefined && m[1] !== '') ? m[1] : m[0];
        const st = m.index + (val === m[0] ? 0 : m[0].indexOf(val));
        out.push(Span(st, st + val.length, r.type || 'ORG', val, 0.9, '规则:' + (r.name || '自定义')));
        if (++n >= 500) break;   // 防止写错的正则匹配爆炸
      }
      if (Date.now() - t0 > 300) r.slow = true;
    }
    return out;
  }

  function detectMoney(text) {
    const out = [];
    const docCurrency = /单位\s*[:：]\s*(?:人民币)?\s*(?:元|千元|万元|百万元|亿元)|人民币|RMB|万元|亿元|千元/.test(text);
    MONEY_RE.lastIndex = 0;
    let m;
    while ((m = MONEY_RE.exec(text)) !== null) {
      const num = m.groups.num, unit = m.groups.unit, cur = m.groups.cur;
      if (!num) continue;
      if (m[0].length === 0) { MONEY_RE.lastIndex++; continue; }
      const digits = num.replace(/,/g, '');
      if (digits.split('.')[0].length > 12) continue;

      // num 分组在原文中的绝对位置
      const ns0 = m.index + m[0].indexOf(num);
      const ne0 = ns0 + num.length;

      if (ns0 > 0 && isAsciiAlpha(text[ns0 - 1])) continue;
      if (ne0 < text.length && isAsciiAlpha(text[ne0]) && !unit) continue;

      // 财务报表惯例：括号包起来的数字是负数，净利润(1,234)万元
      const bch = ns0 > 0 ? text[ns0 - 1] : '';
      const ach = text[ne0] || '';
      if ((bch === '(' || bch === '（') && (ach === ')' || ach === '）')) {
        const hasSep = digits.indexOf(',') >= 0;
        const afterParen = text.slice(ne0 + 1, ne0 + 7);
        const hasUnit = /^\s*(?:十亿元|亿元|万元|千万元|百万元|十亿|百万|千万|亿|万|千元|元)/.test(afterParen);
        // 带千分位、或紧跟单位，才认定为负数额；避免 (1)(2) 编号和 (2025) 年份
        if ((hasSep || hasUnit) && !/^(?:19|20)\d{2}$/.test(digits)) {
          out.push(Span(ns0 - 1, ne0 + 1, 'MONEY', text.slice(ns0 - 1, ne0 + 1), 0.85, '括号负数'));
        }
        continue;
      }

      const tail = text.slice(ne0, ne0 + 3).replace(/^\s+/, '');
      if (tail[0] === '%' || tail[0] === '％') continue;
      if ('.、)）'.indexOf(tail[0]) >= 0 && !unit && !cur) continue;
      if ('年月日季周点号'.indexOf(tail[0]) >= 0) continue;

      const prev = text.slice(Math.max(0, ns0 - 3), ns0).replace(/\s+$/, '');
      const pch = prev[prev.length - 1];
      // "第/第Q/Q3/H1" 是序号或季度
      if ('第QH'.indexOf(pch) >= 0) continue;
      // 只有"数字 + 年月日"才是日期（2025年/3月/15日）；
      // "去年/今年/全年/上半年/上月" 里的年月不是日期，否则会漏掉大量真实财务数据
      if ('年月日'.indexOf(pch) >= 0 && /\d/.test(prev[prev.length - 2] || '')) continue;
      if (/\d{4}\s*[-/.]\s*$/.test(prev)) continue;
      if (!unit && /^(?:19|20)\d{2}$/.test(digits)) continue;

      // 后面跟量词的不是金额：5.2万人、12,000平方米、1,240家门店
      // 起点用整个匹配的末尾：数字和单位之间可能有空格（"4.2 万平方米"）
      const qFrom = m.index + m[0].length;
      const quant = text.slice(qFrom, qFrom + 4);
      if (/^(?:人|家|个|台|辆|吨|平方米|平米|亩|间|所|条|次|位|张|套|批|只|件|箱|瓶|袋|支|片|克|千克|公斤|斤|升|毫升|度|小时|分钟|公里|千米|米|座|栋|层|手|户|票|单|笔|项|例|款|名|天|年|月)/.test(quant)) continue;

      const v = parseFloat(digits);
      if (isNaN(v)) continue;
      const mult = UNIT_MULT[unit || ''] || 1;
      const real = v * mult;
      const ctx = text.slice(Math.max(0, ns0 - 14), ns0) + text.slice(ne0, ne0 + 14);
      const nearCtx = new RegExp(MONEY_CONTEXT, 'i').test(ctx);
      // PDF 表格拍平后，"单位：万元"在表头、数字在几行之后：带千分位的数字在有货币单位的文档里按金额处理
      const afterTxt = text.slice(m.index + m[0].length, m.index + m[0].length + 10);
      const tableMoney = (docCurrency && /,\d{3}/.test(num)) ||
        /^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(num) ||                       // 千分位 + 两位小数（26,315.91），几乎只出现在金额里
        (/,\d{3}/.test(num) && /^\s*\d{1,3}(?:\.\d{1,2})?%/.test(afterTxt) &&
         !/(?:人数|员工|人员|门店|网点|客户数|用户|次数|股本|股数|家数|户数|数量)[^\n\r]*$/.test(text.slice(Math.max(0, ns0 - 60), ns0)));   // 行首标签是人数、门店数时不算  // 表格的金额加占比：173,906 2.10%
      if (!(cur || unit || nearCtx || tableMoney)) continue;
      if (!(cur || unit) && real < 100) continue;

      out.push(Span(ns0, ne0, 'MONEY', num, 0.9, unit ? '含单位' : (cur ? '货币' : '语境')));
    }
    // 同一表格行：已有"金额 占比"命中的行里，其余千分位数字也是金额（上年同期金额等列）
    // 行边界一次算好（\n 和 \r 都算），避免每个命中都向前扫描整行导致平方级耗时
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 10 || c === 13) lineStarts.push(i + 1); }
    const lineOf = pos => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const md = (lo + hi + 1) >> 1; if (lineStarts[md] <= pos) lo = md; else hi = md - 1; } return lo; };
    const rowHit = new Set();
    for (const sp of out) if (sp.note === '语境' || sp.note === '含单位') {
      if (/^\s*\d{1,3}(?:\.\d{1,2})?%/.test(text.slice(sp.end, sp.end + 10))) rowHit.add(lineOf(sp.start));
    }
    const startSet = new Set(out.map(o => o.start));
    for (const li of rowHit) {
      const ls = lineStarts[li], le = (li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : text.length);
      if (le - ls > 600) continue;                          // 被压成一行的长表格不做行内扩散
      const line = text.slice(ls, le);
      const label = line.slice(0, line.search(/\d/) < 0 ? line.length : line.search(/\d/));
      if (/人数|员工|人员|门店|网点|客户数|用户|次数|股本|股数|股份数|家数|户数|数量|台数|件数|吨/.test(label)) continue;
      const re = /(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,%])(?!\s*(?:股|人|家|户|次|台|件|吨|个))/g;
      let x;
      while ((x = re.exec(line)) !== null) {
        const st = ls + x.index;
        if (!startSet.has(st)) { startSet.add(st); out.push(Span(st, st + x[0].length, 'MONEY', x[0], 0.85, '同行金额')); }
      }
    }
    // 斜杠系列：4.8/6.3/8.1 亿元——单位只写在最后一个，前面的同样是金额
    const SER = /(?<![\d\/.])(\d{1,12}(?:\.\d{1,6})?(?:\s{0,2}\/\s{0,2}\d{1,12}(?:\.\d{1,6})?){1,8})\s*(?:十亿元|亿元|万元|千万元|百万元|亿|万|元|million|billion|bn|mn)/g;
    let sm;
    while ((sm = SER.exec(text)) !== null) {
      const base = sm.index;
      const re3 = /\d+(?:\.\d+)?/g;
      let x;
      while ((x = re3.exec(sm[1])) !== null) out.push(Span(base + x.index, base + x.index + x[0].length, 'MONEY', x[0], 0.88, '系列值'));
    }
    return out;
  }

  /* ---------------- 检测器：财务科目行 ---------------- */
  const FIN_ITEM = new RegExp(
    '^(?:营业收入|营业成本|营业利润|利润总额|净利润|归母净利润|扣非净利润|毛利|毛利率|净利率|' +
    'EBITDA|EBIT|销售费用|管理费用|研发费用|财务费用|期间费用|税金及附加|' +
    '资产总额|总资产|负债总额|总负债|所有者权益|股东权益|净资产|资产负债率|' +
    '应收账款|应付账款|预收账款|预付账款|存货|货币资金|合同负债|商誉|固定资产|在建工程|' +
    '经营性现金流|投资性现金流|筹资性现金流|经营活动现金流|自由现金流|有息负债|净负债|' +
    '营收|收入|成本|费用|利润|现金流|资产|负债|权益|' +
    'ROE|ROA|ROIC|周转率|周转天数|存货周转|应收周转|增长率|CAGR|增速|市占率|' +
    '客单价|坪效|人效|单店|GMV|ARPU|LTV|CAC|' +
    '合同额|订单额|中标额|投前估值|投后估值|注册资本|实缴资本|募资|管理规模|AUM|IRR|DPI|MOIC|' +
    '资本开支|资本性支出|CAPEX|购建固定资产|折旧摊销|折旧|摊销|利息支出|财务费用|' +
    '单价|报价|折扣率|毛利额|净额|总额|合计|小计)'
  );

  const RATIO_ITEM = /(率|占比|比重|天数|倍数|CAGR|IRR|ROE|ROA|ROIC|MOIC|增速|增长)$/i;

  const NUM_CELL = /^-?[\d,]+(?:\.\d+)?%?$|^\([\d,]+(?:\.\d+)?\)$|^[—\-–/]+$/;

  function parseNumCell(raw) {
    let s = raw.trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/[—\-–]/.test(s) && !/\d/.test(s)) return null;
    const pct = /%$/.test(s);
    s = s.replace(/[%,\s]/g, '');
    if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
    const v = parseFloat(s) * (neg ? -1 : 1);
    return { value: v, pct, text: raw.trim() };
  }

  // 带位置的切分：返回 [{text, start}]
  function splitWithPos(line, delim) {
    const cells = [];
    if (typeof delim !== 'string') {
      const re = new RegExp(delim.source, 'g');
      let last = 0, m;
      while ((m = re.exec(line)) !== null) {
        cells.push({ text: line.slice(last, m.index), start: last });
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      cells.push({ text: line.slice(last), start: last });
      return cells;
    }
    if (typeof delim === 'string') {
      let i = 0;
      while (true) {
        const j = line.indexOf(delim, i);
        if (j < 0) { cells.push({ text: line.slice(i), start: i }); break; }
        cells.push({ text: line.slice(i, j), start: i });
        i = j + delim.length;
      }
    } else {
      const re = new RegExp(delim.source, 'g');
      let last = 0, m;
      while ((m = re.exec(line)) !== null) {
        cells.push({ text: line.slice(last, m.index), start: last });
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      cells.push({ text: line.slice(last), start: last });
    }
    return cells;
  }

  function detectFinRows(text) {
    const out = [];
    let pos = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) { pos += line.length + 1; continue; }
      let delim = null;
      if (line.indexOf('\t') >= 0) delim = '\t';
      else if (/\s{2,}/.test(line)) delim = /\s{2,}/;
      else if ((line.match(/,/g) || []).length >= 2) delim = ',';

      if (delim) {
        const cells = splitWithPos(line, delim);
        const head = cells[0].text.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s:：*]/g, '');
        if (head && FIN_ITEM.test(head)) {
          const ratio = RATIO_ITEM.test(head);
          for (let i = 1; i < cells.length; i++) {
            const cell = cells[i];
            const info = parseNumCell(cell.text);
            if (!info || info.pct || ratio) continue;
            const lead = cell.text.length - cell.text.replace(/^\s+/, '').length;
            out.push(Span(pos + cell.start + lead, pos + cell.start + lead + info.text.length,
              'MONEY', info.text, 0.78, '科目行'));
          }
        }
      }
      pos += line.length + 1;
    }
    return out;
  }

  /* ---------------- 检测器：表格列 ---------------- */
  const HEAD_MONEY = new RegExp(
    MONEY_CONTEXT + '|金额|数额|占比|比重|单价|总量|数量级|余额|借方|贷方|发生额|期初|期末|结存', 'i');
  const HEAD_NAME = /姓名|联系人|负责人|客户经理|经办人|对接人|汇报人|顾问|高管|法人|股东|董事|监事|户名|对方户名|收款人|付款人|对方名称|交易对手/;
  const HEAD_ORG = /客户名称|公司名称|企业名称|机构名称|单位名称|供应商名称|客户全称|机构|单位/;

  function detectTables(text) {
    const out = [];
    let pos = 0;
    let moneyCols = new Set(), nameCols = new Set(), orgCols = new Set(), inTable = false;

    for (const line of text.split('\n')) {
      let delim = null;
      if (line.indexOf('\t') >= 0) delim = '\t';
      else if ((line.match(/,/g) || []).length >= 2) delim = ',';
      else if ((line.match(/\|/g) || []).length >= 2) delim = /\s*\|\s*/;   // 竖线表格
      else if (/\S\s{2,}\S/.test(line)) delim = /\s{2,}/;   // 多空格对齐的表格
      if (!delim) { inTable = false; pos += line.length + 1; continue; }

      let cells = splitWithPos(line, delim);
      // 去掉首尾竖线造成的空单元格，但保留中间的（可能真的是空值）
      if (cells.length > 2 && !cells[0].text.trim()) cells = cells.slice(1);
      if (cells.length > 1 && !cells[cells.length - 1].text.trim()) cells = cells.slice(0, -1);
      // markdown 表格的分隔行：|---|---|
      if (cells.every(c => /^:?-{2,}:?$/.test(c.text.trim()))) { pos += line.length + 1; continue; }
      const nums = cells.filter(c => NUM_CELL.test(c.text.trim())).length;

      if (!inTable) {
        const hasMoney = cells.some(c => HEAD_MONEY.test(c.text));
        const hasName = cells.some(c => HEAD_NAME.test(c.text));
        if ((hasMoney || hasName) && nums <= Math.max(1, Math.floor(cells.length / 3))) {
          moneyCols = new Set(cells.map((c, i) => HEAD_MONEY.test(c.text) ? i : -1).filter(i => i >= 0));
          nameCols = new Set(cells.map((c, i) => HEAD_NAME.test(c.text) ? i : -1).filter(i => i >= 0));
          orgCols = new Set(cells.map((c, i) => HEAD_ORG.test(c.text) ? i : -1).filter(i => i >= 0));
          inTable = moneyCols.size > 0 || nameCols.size > 0 || orgCols.size > 0;
        }
        pos += line.length + 1;
        continue;
      }

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const raw = cell.text.trim();
        const lead = cell.text.length - cell.text.replace(/^\s+/, '').length;
        if (moneyCols.has(i) && raw) {
          const info = parseNumCell(raw);
          if (info && !info.pct) {
            out.push(Span(pos + cell.start + lead, pos + cell.start + lead + info.text.length, 'MONEY', info.text, 0.72, '表格列'));
          }
        } else if (nameCols.has(i) && looksLikeName(raw) && !/[先生女士小姐]$/.test(raw)) {
          out.push(Span(pos + cell.start + lead, pos + cell.start + lead + raw.length, 'PERSON', raw, 0.8, '表格列'));
        } else if (orgCols.has(i) && raw && raw.length >= 2 && /[\u4e00-\u9fa5]/.test(raw)) {
          // 机构名列：整格当公司名
          out.push(Span(pos + cell.start + lead, pos + cell.start + lead + raw.length, 'ORG', raw, 0.8, '表格列'));
        }
      }
      pos += line.length + 1;
    }
    return out;
  }

  // 股权/份额类比例：这类数字是强识别信息，单独一类
  const EQUITY_RE = /(?:持股|占股|股权|股份|出资|表决权|份额)(?:比例|占比)?\s*(?:为|达|约|由|从|：|:)?\s*(\d{1,3}(?:\.\d+)?)\s*[%％]/g;
  // 稀释/降至/增至 后面的比例
  const EQUITY_SHIFT = /(?:稀释至|降至|下降至|上升至|增至|调整为|变为|提高到)\s*(\d{1,3}(?:\.\d+)?)\s*[%％]/g;

  // 另一种语序：持有 67.4% 的股权 —— 股权在后
  const EQUITY_POST = /(\d{1,3}(?:\.\d+)?)\s*[%％]\s*的?\s*(?:股权|股份|份额|表决权|股份数)/g;

  function detectEquity(text) {
    const out = [];
    EQUITY_RE.lastIndex = 0;
    let m;
    while ((m = EQUITY_POST.exec(text)) !== null) {
      const num = m[1];
      const st = m.index + m[0].indexOf(num);
      // 100% 是"全资收购"，属于交易结构而不是身份信息，保留
      if (parseFloat(num) === 100) continue;
      const sp = Span(st, st + num.length + 1, 'PCT', text.slice(st, st + num.length + 1), 0.88, '股权比例');
      sp.role = '股权';
      out.push(sp);
    }
    EQUITY_SHIFT.lastIndex = 0;
    while ((m = EQUITY_SHIFT.exec(text)) !== null) {
      const num = m[1];
      const st = m.index + m[0].lastIndexOf(num);
      const sp = Span(st, st + num.length + 1, 'PCT', text.slice(st, st + num.length + 1), 0.86, '股权变动');
      sp.role = '股权';
      out.push(sp);
    }
    EQUITY_RE.lastIndex = 0;
    while ((m = EQUITY_RE.exec(text)) !== null) {
      const num = m[1];
      const st = m.index + m[0].lastIndexOf(num);
      const en = st + num.length + (/[%％]/.test(text[st + num.length] || '') ? 1 : 0);
      const sp = Span(st, en, 'PCT', text.slice(st, en), 0.9, '股权比例');
      sp.role = '股权';
      out.push(sp);
    }
    return out;
  }

  function detectPercent(text) {
    const out = [];
    const re = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*[%％]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const st = m.index;
      out.push(Span(st, st + m[1].length, 'PCT', m[1], 0.9, ''));
    }
    return out;
  }


  /* ---------------- 简称候选：报告里常用的短名 ---------------- */
  const PLACE = new Set(('北京 上海 广州 深圳 杭州 南京 成都 武汉 西安 天津 重庆 苏州 宁波 青岛 长沙 郑州 合肥 福州 厦门 济南 沈阳 大连 ' +
    '哈尔滨 昆明 贵阳 南宁 南昌 太原 石家庄 兰州 乌鲁木齐 银川 西宁 拉萨 海口 三亚 无锡 佛山 东莞 温州 泉州 唐山 烟台 常州 徐州 ' +
    '嘉兴 绍兴 台州 金华 珠海 中山 惠州 汕头 江门 株洲 湘潭 洛阳 襄阳 宜昌 芜湖 河北 河南 山东 山西 江苏 浙江 安徽 福建 江西 ' +
    '湖北 湖南 广东 广西 海南 四川 贵州 云南 陕西 甘肃 青海 宁夏 新疆 西藏 内蒙 东北 华东 华南 华北 华中 西部 长三角 珠三角').split(' '));

  const ALIAS_STOP = new Set(('有限公司 股份公司 集团 控股 中国 国际 实业 科技 技术 投资 资本 基金 信托 银行 证券 保险 ' +
    '资产 管理 服务 咨询 发展 贸易 电子 能源 材料 医药 生物 地产 置业 汽车 物流 商贸 传媒 文化 教育 医疗 健康 ' +
    '环境 建设 工程 控股 发展 股份 有限 公司').split(' '));

  const GENERIC_ALIAS = /^(?:电池|系统|智能|终端|智慧|物业|能源|科技|电子|材料|设备|技术|服务|管理|发展|投资|控股|实业|贸易|工程|建设|环保|化工|新材|产业|信息|网络|数据|软件|医疗|健康|生物|汽车|交通|物流|地产|置业|金融|资本|证券|基金|保险|银行|信托|有限|股份|公司|集团)+$/;
  function aliasCandidates(text, orgSpans) {
    const out = [];
    if (!orgSpans.length) return out;
    const ranges = orgSpans.map(o => [o.start, o.end]);
    const insideOrg = (i, len) => ranges.some(r => i >= r[0] && i + len <= r[1]);

    for (const sp of orgSpans) {
      const full = sp.text;
      if (full.length < 6) continue;
      for (let L = Math.min(6, full.length - 2); L >= 2; L--) {
        const cand = full.slice(0, L);
        if (PLACE.has(cand) || ALIAS_STOP.has(cand)) continue;
        if (/^(?:中国|国际|亚洲|亚太|全球|全国)/.test(cand)) continue;
        let ambiguous = false;
        for (const o of orgSpans) {
          if (o === sp) continue;
          if (o.text.indexOf(cand) >= 0 && o.text.length > cand.length) { ambiguous = true; break; }
        }
        if (ambiguous) continue;
        if (/\s/.test(cand)) continue;
        if (GENERIC_ALIAS.test(cand)) break;
        const bare = cand.replace(/[市省县区旗]$/, '');
        if (CITY_RE.test(bare) || PROVINCE_RE.test(bare) || PLACE.has(bare)) continue;
        if (!nameRemainderOk(cand) || /^(?:加强|注册|原名|曾用名|曾担任|担任|加盟|自然资源|循环发展|以下简称|简称|全称)/.test(cand) || !/[\u4e00-\u9fa5]/.test(cand) && cand.length < 4) continue;
        let cnt = 0, idx = -1, glued = 0;
        const nextFull = full[L];
        while ((idx = text.indexOf(cand, idx + 1)) >= 0) {
          if (insideOrg(idx, cand.length)) continue;
          // 后面接着全称的下一个字："厦门时代新能源电池项目"里的"厦门时代新能"不是简称，是全称被截断或嵌在别的词里
          if (nextFull && text[idx + L] === nextFull) continue;
          cnt++;
          const nx = text[idx + L] || '';
          if (/[\u4e00-\u9fa5]/.test(nx) && !/[的和与及等在是为将对已已也均、]/.test(nx)) glued++;
        }
        // 短词大多数时候都粘着别的字（"购买资产""循环经济"）：是普通词，不是简称
        if (cnt && L <= 4 && glued / cnt > 0.6 && cnt >= 3) break;
        if (cnt > 0) { out.push({ alias: cand, full: full, count: cnt }); break; }
      }
    }
    const seen = new Set();
    return out.filter(x => { if (seen.has(x.alias)) return false; seen.add(x.alias); return true; });
  }


  /* ---------------- 检测器：内置行业词库 ---------------- */
  const WEAK_BEFORE = /[与和及、，；:：（(对包例如比\s「"']/;
  const WEAK_AFTER = /[等、，。；和与及\s的）)」"']/;

  function weakContextOk(text, st, en) {
    const before = st === 0 ? '' : text[st - 1];
    const after = en >= text.length ? '' : text[en];
    // "工程机械、船舶等行业" —— 后面跟"等/行业/领域"的是品类不是公司
    if (/^(?:等|行业|产业|领域|市场|板块|业务|产品|品类|制造|加工|装备)/.test(text.slice(en, en + 3))) return false;
    const okB = st === 0 || WEAK_BEFORE.test(before);
    const okA = en >= text.length || WEAK_AFTER.test(after);
    return okB && okA;
  }

  const PLACE_LIKE_BRANDS = new Set(['王府井', '西单', '五道口', '国贸', '徐家汇', '春熙路', '太古里', '万象城']);
  function detectLexicon(text, enabledGroups) {
    const out = [];
    const useAll = (enabledGroups === undefined || enabledGroups === null);
    for (let i = 0; i < text.length; i++) {
      const arr = LEX_BUCKET.get(text[i]);
      if (!arr) continue;
      for (let j = 0; j < arr.length; j++) {
        const name = arr[j];
        const g = LEX_GROUP_OF[name];
        if (!useAll && g && enabledGroups.indexOf(g) < 0) continue;
        if (useAll && g && LEX.GROUPS[g] && LEX.GROUPS[g].optIn) continue;        // 需手动开启的词库
        if (!text.startsWith(name, i)) continue;
        // 英文名要检查词边界，中文名不需要
        if (/[A-Za-z]$/.test(name)) {
          const prev = i > 0 ? text[i - 1] : '';
          const next = text[i + name.length] || '';
          if (/[A-Za-z]/.test(prev) || /[A-Za-z]/.test(next)) continue;
        }
        // 只有两字词歧义大（美的/大众/小米）；三字以上品牌名直接认
        if (name.length <= 2 && LEX.WEAK.has(name) && !weakContextOk(text, i, i + name.length)) continue;
        // 品牌同时是地名（王府井/西单/五道口…）：后面跟"店/商圈/大街/一带"时按地名处理
        if (/^(?:店|商圈|大街|步行街|商业街|地区|一带|附近|片区|周边|地铁站|站)/.test(text.slice(i + name.length, i + name.length + 3))) continue;
        if (/[在于]$/.test(text.slice(Math.max(0, i - 1), i)) && /^[、，和与及]/.test(text[i + name.length] || '') && PLACE_LIKE_BRANDS.has(name)) continue;
        out.push(Span(i, i + name.length, 'ORG', name, 0.95, '内置词库'));
        i += name.length - 1;
        break;
      }
    }
    return out;
  }

  function detectPseudo(text) {
    const out = [];
    const seen = new Set();
    for (const rule of LEX.PSEUDO || []) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text)) !== null) {
        const hit = m[0].trim();
        if (!hit || seen.has(hit + '@' + m.index)) continue;
        seen.add(hit + '@' + m.index);
        out.push({ text: hit, msg: rule.msg, tip: rule.tip, pos: m.index });
        if (out.length > 30) return out;
        if (m[0].length === 0) rule.re.lastIndex++;
      }
    }
    return out;
  }


  /* ---------------- 简称归并：同一实体只用一个代号 ---------------- */
  // "华润万佳商业集团有限公司" 与正文里的 "华润万佳" 必须共用一个代号，
  // 否则 AI 会把一家公司当成两家。
  function mergeOrgAliases(text, orgSpans, allSpans) {
    const extra = [];
    // 区间索引：先按起点排序，查的时候二分，避免每个候选都扫一遍全部实体
    const sorted = allSpans.slice().sort((a, b) => a.start - b.start);
    const starts = sorted.map(o => o.start);
    const inOther = (i, len) => {
      let lo = 0, hi = starts.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= i) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      for (let k = idx; k >= 0 && k > idx - 8; k--) {
        const o = sorted[k];
        if (i >= o.start && i + len <= o.end) return true;
      }
      return false;
    };

    for (const sp of orgSpans) {
      if (sp.text.length < 5) continue;
      const core = sp.text.replace(/(?:股份有限公司|有限责任公司|有限公司|有限合伙|集团|控股|股份)$/, '');
      if (core.length < 3) continue;

      // 字号常常不是前缀：深圳优鲜科技 → 优鲜科技。去掉地名再试一次
      const PLACE_PRE = /^(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|宁波|青岛|长沙|郑州|合肥|福州|厦门|济南|沈阳|大连|无锡|佛山|东莞|珠海|中山|香港|澳门|中国)/;
      const cores = [core];
      if (PLACE_PRE.test(core)) {
        const stripped = core.replace(PLACE_PRE, '');
        if (stripped.length >= 3) cores.push(stripped);
      }

      const cands = [];
      for (const c0 of cores) {
        for (let L = Math.min(6, c0.length); L >= 3; L--) cands.push(c0.slice(0, L));
      }
      for (const alias of cands) {
        if (PLACE.has(alias) || ALIAS_STOP.has(alias)) continue;
        const positions = [];
        let idx = -1;
        while ((idx = text.indexOf(alias, idx + 1)) >= 0) {
          if (idx >= sp.start && idx + alias.length <= sp.end) continue;  // 全称内部
          if (inOther(idx, alias.length)) continue;                       // 落在别的实体里
          positions.push(idx);
        }
        if (positions.length < 2) continue;   // 只出现一次的前缀多半是巧合
        for (const p of positions) {
          const a = Span(p, p + alias.length, 'ORG', alias, 0.9, '简称');
          a.canon = sp.text;
          extra.push(a);
        }
        break;
      }
    }
    return extra;
  }

  /* ---------------- 显式简称：（以下简称"优鲜"） ---------------- */
  // 中文合同/报告最常见的写法，明确声明了简称，必须绑定到前面的实体
  const ALIAS_DECL = /[（(]?以下简称\s*[""「『']?([^""」』'），。；\s]{2,12})[""」』']?\s*[）)]?/g;

  function detectDeclaredAliases(text, spans) {
    const out = [];
    ALIAS_DECL.lastIndex = 0;
    let m;
    while ((m = ALIAS_DECL.exec(text)) !== null) {
      const alias = m[1];
      if (!alias || alias.length < 2) continue;
      let host = null;
      for (const sp of spans) {
        if (sp.type === 'ORG' && sp.end <= m.index && (!host || sp.end > host.end)) host = sp;
      }
      if (!host) continue;
      const canon = host.canon || host.text;
      const st = m.index + m[0].indexOf(alias);
      let idx = -1;
      while ((idx = text.indexOf(alias, idx + 1)) >= 0) {
        if (spans.some(o => o !== host && idx >= o.start && idx + alias.length <= o.end)) continue;
        const sp = Span(idx, idx + alias.length, 'ORG', alias, 0.95, '以下简称');
        sp.canon = canon;
        out.push(sp);
      }
    }
    return out;
  }

  /* ---------------- 角色识别：让代号带语义 ---------------- */
  // 投融资文档里，标的、买方、卖方、顾问全叫"企业A/B/C"是灾难——
  // AI 分不清谁是谁，分析结论必然错。给代号加角色标签。
  const ROLES = [
    { key: '标的', re: /(?:标的公司|目标公司|被收购方|被投企业|标的资产|标的方)/ },
    { key: '买方', re: /(?:收购方|买方|受让方|投资方|增资方|认购方|并购方)/ },
    { key: '卖方', re: /(?:转让方|卖方|出售方|退出方|出让方)/ },
    { key: '供应商', re: /(?:供应商|供货方|上游厂商)/ },
    { key: '客户', re: /(?:客户|甲方|采购方|下游客户)/ },
    { key: '顾问', re: /(?:财务顾问|保荐机构|主承销商|独家顾问)/ },
    { key: '律所', re: /(?:法律顾问|律师事务所|律所)/ },
    { key: '审计', re: /(?:审计机构|会计师事务所|审计师|评估机构)/ },
    { key: '竞对', re: /(?:竞争对手|竞对|同业公司)/ },
    { key: '股东', re: /(?:控股股东|实际控制人|实控人|股东|出资方)/ },
    { key: '关联', re: /(?:子公司|母公司|关联方|合资公司|参股公司)/ }
  ];

  function detectRoles(text, spans) {
    const orgs = spans.filter(s => s.type === 'ORG' && !s.canon && !s.role);
    if (!orgs.length) return;

    // 按句切分
    const bounds = [];
    let st = 0;
    for (let i = 0; i < text.length; i++) {
      if ('。；;\n'.indexOf(text[i]) >= 0) { bounds.push([st, i]); st = i + 1; }
    }
    bounds.push([st, text.length]);

    // 机构按位置排序后用指针推进：原来每句都 filter 一遍全部机构，句子 × 机构是平方级
    orgs.sort((a, b) => a.start - b.start);
    let oi = 0;
    for (const [bs, be] of bounds) {
      while (oi < orgs.length && orgs[oi].start < bs) oi++;
      const inSent = [];
      for (let k = oi; k < orgs.length && orgs[k].start < be; k++) if (orgs[k].end <= be) inSent.push(orgs[k]);
      if (!inSent.length) continue;
      const sent = text.slice(bs, be);

      const hits = [];
      for (const r of ROLES) {
        const re = new RegExp(r.re.source, 'g');
        let m;
        while ((m = re.exec(sent)) !== null) {
          hits.push({ key: r.key, pos: bs + m.index, len: m[0].length });
        }
      }
      if (!hits.length) continue;

      const used = new Set();
      hits.sort((x, y) => x.pos - y.pos);
      // 二分：第一个 pos >= v 的命中下标
      const lb = v => { let lo = 0, hi = hits.length; while (lo < hi) { const md = (lo + hi) >> 1; if (hits[md].pos < v) lo = md + 1; else hi = md; } return lo; };
      // 角色词就在实体名里（"金杜律师事务所"）——直接归它，别让邻居抢走
      for (const o of inSent) {
        for (let k = lb(o.start); k < hits.length && hits[k].pos < o.end; k++) {
          const h = hits[k];
          if (h.pos + h.len <= o.end && !o.role && !used.has(h)) { o.role = h.key; used.add(h); }
        }
      }
      // 其余机构：找 24 字以内最近的未用角色词（只看附近的命中，避免 机构 × 命中 的平方级）
      for (const o of inSent) {
        if (o.role) continue;
        let best = null, bd = 1e9;
        for (let k = lb(o.start - 64); k < hits.length && hits[k].pos <= o.end + 24; k++) {
          const h = hits[k];
          if (used.has(h)) continue;
          const d = (h.pos + h.len <= o.start) ? o.start - (h.pos + h.len) : Math.abs(h.pos - o.end);
          if (d < bd) { bd = d; best = h; }
        }
        if (best && bd <= 24) { o.role = best.key; used.add(best); }
      }
    }
  }


  /* ---------------- 同名扩散：识别出一处，全文一起脱 ---------------- */
  // 真实文档里同一个名字会出现很多次。只脱"被规则命中的那一处"，
  // 其余原样保留，等于没脱——这是最容易漏的方式。
  function propagateNamed(text, spans) {
    const extra = [];
    if (!spans.length) return extra;

    // 已覆盖区间：二分查找，避免每个候选扫一遍全部实体
    const sorted = spans.slice().sort((a, b) => a.start - b.start);
    const starts = sorted.map(o => o.start);
    const covered = (i, len) => {
      let lo = 0, hi = starts.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= i) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      for (let k = idx; k >= 0 && k > idx - 10; k--) {
        const o = sorted[k];
        if (i >= o.start && i + len <= o.end) return true;
      }
      return false;
    };

    const seen = new Set();
    for (const sp of spans) {
      if (sp.type !== 'PERSON' && sp.type !== 'ORG') continue;
      const w = sp.text;
      if (!w || w.length < 2) continue;
      // 两字的机构名歧义太大（大众、美的、小米），不扩散；两字人名相对安全
      if (sp.type === 'ORG' && w.length < 3) continue;
      // 代号形态的（已是【企业A】）不用扩散
      if (w.indexOf('【') >= 0) continue;
      const key = sp.type + ':' + w;
      if (seen.has(key)) continue;
      // 弱规则（称谓/语境/同名扩散本身）识别出的不参与扩散——
      // 一旦误判会被放大到全文，宁可少扩散
      if ((sp.conf || 0) < 0.88) continue;
      seen.add(key);

      let idx = -1, n = 0;
      while ((idx = text.indexOf(w, idx + 1)) >= 0) {
        if (covered(idx, w.length)) continue;
        const x = Span(idx, idx + w.length, sp.type, w, 0.9, '同名扩散');
        if (sp.role) x.role = sp.role;
        if (sp.canon) x.canon = sp.canon;
        extra.push(x);
        if (++n >= 300) break;
      }
    }
    return extra;
  }

  /* ---------------- 重叠消解 ---------------- */
  // 同字头简称：全称"内蒙古双欣环保材料股份有限公司"在文中出现时，
  // "双欣化工""双欣资源"这类"字头 + 行业词"的写法也是同一集团的主体
  const REGION_PREFIX = /^(?:中国|内蒙古|黑龙江|新疆|西藏|宁夏|广西|香港|澳门|台湾|[一-龥]{2}省|[一-龥]{2}市|北京|上海|天津|重庆|河北|山西|辽宁|吉林|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|深圳|广州|杭州|南京|苏州|成都|武汉|西安|宁波|青岛|厦门|长沙|郑州|合肥|无锡|东莞|佛山|珠海)+/;
  const INDUSTRY_TAIL = '电子|国际|化工|资源|医疗|光电|新材|物流|生物|资本|投资|科技|医药|控股|集团|股份|实业|环保|能源|材料|制造|智能|汽车|食品|地产|置业|传媒|网络|软件|数据|信息|电气|机械|重工|重能|重装|旅游|酒店|文旅|索道|航空|物业|商贸|贸易|供应链|半导体|健康|新能源|证券|基金|银行|保险|金融|租赁';
  const HEAD_STOP = /^(?:中国|中华|国际|石油|移动|人寿|国有|资产|城市|全球|亚洲|华东|华南|华北|华中|西南|东北|西北|股份|有限|集团|控股|投资|科技|实业|发展|建设|产业|新材|电子|医药|生物|能源|资本|信息|技术|管理|咨询|服务|贸易|国家|人民|公司)$/;
  function detectHeadAliases(text, orgSpans, spans) {
    const heads = new Set();
    for (const o of orgSpans) {
      if (!/有限公司|有限责任公司|股份有限公司|集团|控股|合伙/.test(o.text)) continue;
      const body = o.text.replace(REGION_PREFIX, '');
      const h = body.slice(0, 2);
      if (h.length === 2 && /^[一-龥]{2}$/.test(h) && !HEAD_STOP.test(h)) heads.add(h);
    }
    if (!heads.size) return [];
    const out = [];
    const re = new RegExp('(' + Array.from(heads).join('|') + ')(?:' + INDUSTRY_TAIL + ')(?:公司|集团)?', 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const st = m.index, en = st + m[0].length;
      if (spans.some(x => x.start <= st && x.end >= en)) continue;   // 已在别的实体里
      if (ALIAS_GENERIC.test(m[0])) continue;                             // "石油化工""移动通信"是行业词
      out.push(Span(st, en, 'ORG', m[0], 0.88, '同字头简称'));
    }
    return out;
  }

  /* ---- 上下文里的机构简称（没有"有限公司"后缀，但语境明确） ---- */
  const ORG_CAND_BAD = /^(?:公司|本公司|该公司|其|我们|他们|你们|我方|对方|客户|上述|相关|部分|一些|多家|这家|那家|各家|同行|行业|市场|政府|监管|企业|集团|子公司|母公司|股东|公众|个人|员工|团队|管理层|董事会)$|担任|负责|工作|期间|以及|并且|其中|的|了|在|于|和|与|及|或|是|为|将|已|曾|现/;
  function orgCandOk(x) {
    if (!x || x.length < 2 || x.length > 16) return false;
    if (/\d|额/.test(x) || ORG_CAND_BAD.test(x) || ORG_STOP.has(x)) return false;
    // 会计科目、说明性短语不是机构：采购额 / 销售额占年度销售总额比例 / 单位任职情况 / 具体情况参见本招股说明书
    if (/(?:额|比例|占比|情况|方式|说明书|说明|账号|账户|号码|任职|费用|成本|收入|利润|负债|率|期间|年度|部分|内容|事项|章节|规定|要求|单位)$/.test(x)) return false;
    if (/^(?:具体|直接|间接|上述|本次|此|其他|其余|全部|主要|前五名|年度|报告期|期末|期初|账号|单位|应|需|须|可|拟)/.test(x)) return false;
    if (new RegExp('^(?:' + MONEY_CONTEXT + ')$').test(x)) return false;
    if (/^[A-Za-z.]+$/.test(x) && x.replace(/[^A-Za-z]/g, '').length < 3) return false;
    if (LEX.GENERIC && LEX.GENERIC.has(x)) return false;
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(x) && looksLikeName(x) && x.length === 3 && !/(?:电子|科技|资本|投资|医疗|生物|物流|智|聚|达|通|联|泰|华|源|鑫|盛|恒|远|德|信)/.test(x.slice(1))) return false;  // 看起来是人名的不当机构
    return true;
  }
  // 只保留在封存集上验证过、误伤可控的两类语境（履历、持股路径、上市主体、口语指代、英文+公司 已删除：误伤远大于收益）
  const ORG_CTX = [
    // 股权：控股股东双欣化工 / 机构股东还包括A、B、C / 母公司为X。母公司、子公司必须跟"为/包括/是"
    { re: /(?:控股股东|间接控股股东|法人股东|机构股东|关联方)(?:还包括|包括|为|是|系)?[：:]?\s*|(?:大股东|股东|子公司|孙公司|参股公司|控股子公司|全资子公司|母公司|合营企业|联营企业)(?:还包括|包括|为|是|系)[：:]?\s*/g, list: true, conf: 0.88, note: '股权语境' },
    // 投资对象：对天泽生物的 C 轮投资（排除 对项目/行业/赛道/人才 的投资）
    { re: /(?:对|向)\s*([一-龥]{2,10}?)(?=的?(?:[A-E]\+?|Pre-[A-E]|天使|种子|战略)?轮?(?:投资|增资|注资|收购|并购|尽调|估值))/g, conf: 0.88, note: '投资对象' }
  ];
  const INVEST_BAD = /^(?:项目|行业|赛道|人才|新能源|消费|医疗|龙头|领域|板块|企业|公司|标的|资产|业务|市场|技术|研发|产能|团队|平台|子公司|母公司|该公司|本公司|其|上述|相关|部分|多个|多家)|(?:行业|赛道|领域|板块|项目|业务|市场|龙头|人才|消费品|企业|公司)$/;
  const ITEM_BAD = /^(?:董事|监事|高级管理人员|高管|管理层|自然人|法人|全资子公司|控股子公司|子公司|母公司|国有资本|民营资本|外资|外资股东|研发中心|生产基地|销售公司|分公司|事业部|分别|其他|其余|上述|本公司|发行人|公司|员工|员工持股平台|持股平台|实际控制人|控股股东|一致行动人|配偶|家族|个人|机构|基金|信托|银行|证券|保险)$|(?:职务|人员|部门|中心|基地|地区|区域|省|市|县|区|董事|监事|高管|高级管理人员|员工|股东|服务机构)$|^(?:通过|持有|将|已|拟|在|于|对|向|与|和|为|是|的|系|均|及|应|需|可|所|其|自然人|第三方|外部|专业|相关|多家|一家)/;
  const CITY_RE = /^(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|宁波|青岛|长沙|郑州|合肥|福州|厦门|济南|沈阳|大连|无锡|佛山|东莞|珠海|中山|香港|澳门|台北|新加坡|东京|纽约|伦敦|华东|华南|华北|华中|西南|东北|西北|海外|境外|国内)$/;
  function orgItemOk(x) {
    if (ITEM_BAD.test(x) || CITY_RE.test(x)) return false;
    if (/^[一-龥]{2,3}$/.test(x) && looksLikeName(x, true) && !/(?:电子|科技|资本|投资|医疗|生物|物流|基金|信托|资产|集团|股份|控股)$/.test(x)) return false;   // 像人名
    if (new RegExp('^(?:' + MONEY_CONTEXT + ')').test(x) && x.length <= 6) return false;   // 营收、毛利三项（以科目词开头）
    return true;
  }
  function detectOrgContext(text, spans) {
    const out = [];
    for (const rule of ORG_CTX) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text)) !== null) {
        if (m[0].length === 0) { rule.re.lastIndex++; continue; }
        if (!rule.list) {
          const x = m[1], st = m.index + m[0].indexOf(x);
          if (rule.note === '投资对象' && INVEST_BAD.test(x)) continue;
          if (orgCandOk(x) && orgItemOk(x)) out.push(Span(st, st + x.length, 'ORG', x, rule.conf, rule.note));
          continue;
        }
        // 名单：顿号 / 和 / 及 分隔，最多 8 项
        let pos = m.index + m[0].length;
        for (let k = 0; k < 8; k++) {
          const g = /^([\u4e00-\u9fa5A-Za-z]{2,12}?)(?=、|，|,|和|及|与|间接|直接|合计|共同|持有|外|之|的|等|。|；|\s|$)/.exec(text.slice(pos, pos + 20));
          if (!g || !orgCandOk(g[1]) || !orgItemOk(g[1])) break;
          out.push(Span(pos, pos + g[1].length, 'ORG', g[1], rule.conf, rule.note));
          pos += g[1].length;
          const sep = /^\s*(?:、|和|及|与)\s*/.exec(text.slice(pos, pos + 3));
          if (!sep) break;
          pos += sep[0].length;
        }
      }
    }
    // 名单扩散：顿号名单里已确认机构至少占一半时，其余 2–10 字的项也按机构处理（蒙兴基金、中信金融资产、华鑫信托）
    let mx = text.length + 1;
    const cov = new Uint8Array(mx);
    for (const k of spans.concat(out)) if (k.type === 'ORG' && (k.conf || 0) >= 0.85) for (let i = Math.max(0, k.start); i < Math.min(k.end, mx); i++) cov[i] = 1;
    const LIST = /(?:[一-龥A-Za-z]{2,10}、)+[一-龥A-Za-z]{2,10}/g;   // 只认顿号名单
    let lm;
    while ((lm = LIST.exec(text)) !== null) {
      const items = [];
      const re = /[一-龥A-Za-z]{2,10}/g;
      let im;
      while ((im = re.exec(lm[0])) !== null) items.push({ st: lm.index + im.index, x: im[0] });
      if (items.length < 2 || items.length > 12) continue;
      const isHit = it => { for (let i = it.st; i < it.st + it.x.length; i++) if (cov[i]) return true; return false; };
      const hits = items.filter(isHit);
      if (!hits.length || hits.length === items.length || hits.length * 2 < items.length) continue;
      for (const it of items) {
        if (isHit(it) || !orgCandOk(it.x) || !orgItemOk(it.x)) continue;
        out.push(Span(it.st, it.st + it.x.length, 'ORG', it.x, 0.86, '名单扩散'));
      }
    }
    return out;
  }

  /* ---- v2.2 疑似实体：高召回、需要用户确认的候选（不自动脱敏） ---- */
  // 这些写法在真实文档里很常见，但直接替换误伤太多，所以只列出来让用户一键确认
  const SUSPECT_RULES = [
    { type: 'ORG', why: '履历语境', re: /(?:于|在|加入|就职于|任职于|供职于|入职|离开|创办|创立|联合创立)\s*([\u4e00-\u9fa5]{2,12}?)(?=担任|任职|工作|就职|任|期间|实习|从事)/g },
    { type: 'ORG', why: '持股路径', re: /通过\s*([\u4e00-\u9fa5]{2,10}?(?:[、和及与][\u4e00-\u9fa5]{2,10}?){0,6})(?=\s*(?:间接|直接|合计|共同|分别|合并)?\s*持有)/g, list: true },
    { type: 'ORG', why: '上市主体', re: /([\u4e00-\u9fa5]{2,10}?)(?=(?:拟|计划|正在|已)?(?:在|于|赴)?(?:上交所|深交所|北交所|港交所|联交所|科创板|创业板|主板|纳斯达克|纽交所)(?:科创板|创业板|主板)?(?:上市|IPO|递表|挂牌|申报))/g },
    { type: 'ORG', weak: true, why: '口语指代', re: /(?:跟|和|与|找|问|对接)\s*([\u4e00-\u9fa5]{2,6}?)(?=那边|这边|那家|这家)/g },
    { type: 'ORG', why: '英文名 + 公司', re: /\b([A-Z][A-Za-z&.'-]{1,30}(?:\s+[A-Z][A-Za-z&.'-]{1,30}){0,4})\s*(?=公司|集团|基金|银行|资本)/g },
    { type: 'ORG', weak: true, why: '集团关系', re: /(?:子公司|孙公司|母公司|参股公司|关联方|旗下)([\u4e00-\u9fa5]{2,8}?)(?=的|之|，|。|、|；)/g },
    { type: 'ORG', why: '行业词尾', re: /(?<![一-龥])([一-龥]{2,4}(?:电子|化工|医疗|光电|新材|物流|生物|资本|投资|科技|医药|控股|集团|股份|实业|半导体|新能源|药业|制药|器械|精密|租赁|保理|创投|置业|地产|重工|电气|智能|汽车))(?![一-龥])/g },
    { type: 'ORG', weak: true, why: '引号名称', re: /(?:叫|名为|简称|代号|品牌|项目)[“"「『]([\u4e00-\u9fa5A-Za-z0-9]{2,8})[”"」』]/g },
    { type: 'PERSON', weak: true, why: '只有名的称呼', re: /(?:^|[，。；\n]|Hi |致)([\u4e00-\u9fa5]{2})(?=补充|建议|表示|说|提到|认为|负责|确认|反馈|汇报)/g },
    { type: 'PERSON', weak: true, why: '英文名', re: /(?<=[与和跟找问让请@、]\s?)([A-Z][a-z]{2,12})(?=\s*[\u4e00-\u9fa5])/g }
  ];
  const SUSPECT_BAD = /^(?:旗下|较多|较少|众多|多个|高端|中端|低端|头部|一期|二期|三期|四期|首期|渠道|研发|监管|运营|技术|风控|合规|生产|质量|品牌|客服|行政|采购|投行|律所|券商|交易所|四大|本行|本所|头部|大厂|创业公司|初创公司|销售|市场部|美国|日本|欧洲|英国|德国|韩国|正在|标的企业|标的公司|银行借款|甲方|乙方|丙方|要先|包括|间接|直接|持有|提前|谈|将|已|拟|在|于|对|向|把|被|让|给|一下|上交所|深交所|北交所|港交所|联交所|科创板|创业板|主板|纳斯达克|纽交所|今年|去年|明年|同年|当年|此前|之后|期间|报告期|本届|疫情|总部|海外|国内|境外|一线|二线|行业|行业内|公司|本公司|我们|他们|你们|对方|客户|老板|领导|财务|法务|律师|审计|人事|团队|项目|项目组|管理层|董事会|邮件|协议|配偶|家族|信托|二级市场|自有资金|大宗交易|定向增发|持股平台|一致行动|下属企业|多家|很多|部分|其他|本次|计划|发行人|该公司)/;
  const EN_SUSPECT_BAD = /^(?:Mac|Agent|Office|Skill|Code|Claude|Chrome|Safari|Windows|Linux|Docker|GitHub|Pro|Max|Plus|Ultra|Apple|Google|Microsoft|Tesla|Amazon|Meta|Nvidia|OpenAI|The|This|That|These|Our|We|Your|SaaS|CRO|IPO|ESG|TMT|FOF|REITs?|VIE|SPV|NewCo|Excel|PPT|Word|Wind|Bloomberg|Choice|Python|AI|API|App|Big|New|Hong|Action|Items|Update|Draft|Final|Model|Memo|Deck|Email|Note|Notes|Data|Team|All|Best|Regards|Thanks|Hi|Dear)$/;

  // 两字常用词：不是"只有名的称呼"
  const COMMON_2 = new Set('专家 机构 券商 业内 监管 买方 卖方 我方 多数 普遍 基金 媒体 投资 央行 政府 国家 同行 研发 运营 技术 风控 合规 员工 用户 分析 研究 市场 管理 销售 采购 投行 律所 审计 股东 董事 高管 创始 合伙 顾问 专业 业界 外界 舆论 主流 少数 部分 有人 对此 此前 随后 最终 整个 主要 上次 同时 其中 另外 此外 目前 最后 首先 其次 然后 后来 因此 所以 但是 不过 而且 并且 如果 虽然 总体 整体 大家 我们 他们 你们 对方 客户 老板 领导 财务 法务 会上 会后 会议 本周 上周 下周 今天 明天 昨天 现在 当时 之前 之后 最近 已经 还是 可能 应该 需要 建议 具体 关于 对于 根据 按照 通过 经过 结果 情况 问题 方面 部分 全部 双方 各方 公司 项目 团队 业务 市场 行业 产品 渠道 门店 数据 模型 方案 计划 预算 合同 协议 报告 材料 文件 邮件 附件 内容 时间 节点 进度 风险 机会 重点 难点 核心 关键'.split(' '));
  // 行业通用词不是公司名
  const INDUSTRY_GENERIC = new Set('医疗器械 生物医药 新能源汽车 半导体 光伏 储能 人工智能 智能制造 工业互联网 消费电子 汽车电子 金融科技 高端制造 精密制造 新材料 化工新材 创新药 医药生物 智能汽车 互联网大厂 科技大厂 地产开发 产业资本 风险投资 股权投资 私募股权 天使投资 战略投资 财务投资 国有资本 民营资本 外资控股'.split(' '));
  // "投资建议 / 投资者 / 对外投资"：同一个词在文中还作为别的词的前半截出现，就不是名字
  const SPEAK_NEXT = /^(?:补充|建议|表示|说|提到|认为|负责|确认|反馈|汇报|指出|强调|透露|介绍|回应|提出|发言|主持)/;
  // 年报、招股书、审计报告里的会计和制度用语：不是公司名（整份 PDF 导入时这类词会大量出现）
  const FIN_GENERIC = /(?:会计|准则|审计|合同|租赁|期内|以后|这些|按照|执行|监测|关系|指定|提供|权利|进行|不断|放弃|根据|属于|产生|发生|存在|免征|增资|投入|转增|减少|追加|回购|募集|承诺|预测|运作|之间|以外|控制|权益|工具|债权|股权|长期|联营|合营|针对|本人|条件|房地产|注册|资本化|投资性|金融资|消费|使用|以下|一定|恰当|原定|整个|职工|公允|减值|摊销|折旧|计提|递延|应收|应付|票据|存货|负债|所得税|股本|溢价|分红|利润|收益|损益|报表|披露|期末|期初|本期|上期|累计|合计|其中|其他|子公司|母公司|少数股东|债务|初始|现金|流量|取得|人工智能)/;
  const PROVINCE_RE = /^(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|中国|全国|亚洲|全球|国际)$/;
  // 通用词素：会计用语和行业词。候选去掉这些之后还剩 2 个字以上的"名字部分"才算数
  //（"长期股权投资"去完什么都不剩；"红杉股权投资"剩"红杉"）
  const GENERIC_MORPH = ('金融资产 金融资 人工智能 房地产 新能源 半导体 所得税 长期 股权 债权 债务 权益 工具 投资 资本 资金 募集 回购 股份 初始 现金 流量 ' +
    '注册 转增 减少 追加 承诺 联营 合营 企业 条件 投入 科技 电子 精密 智能 生物 医药 汽车 化工 医疗 光电 新材 物流 控股 集团 实业 ' +
    '药业 制药 器械 租赁 保理 创投 置业 地产 重工 电气 消费 监测 会计 准则 审计 合同 公允 减值 摊销 折旧 计提 递延 应收 应付 票据 ' +
    '存货 负债 股本 溢价 分红 利润 收益 损益 报表 披露 期末 期初 本期 上期 累计 合计 其他 其中 信息 技术 服务 工业 证券 个月').split(' ');
  const FUNC_ONLY = /^[为的了在和与及或对向从按以其该本各转进行将已被所于之性]+$/;
  const LEAD_VERB = /^(?:取得|购买|收购|出售|转让|包括|通过|向|对|与|和|及|或|将|按|以|为|其|该|本)/;
  function nameRemainderOk(x) {
    let r = x;
    for (const m of GENERIC_MORPH) if (r.indexOf(m) >= 0) r = r.split(m).join('');
    if (r.length < 2 || FUNC_ONLY.test(r)) return false;
    if (CITY_RE.test(r) || PROVINCE_RE.test(r)) return false;
    return true;
  }
  const VERBISH = new Set('使用 以下 以后 恰当 一定 原定 整个 未来 补偿 职工 实际 报告期 本期 上期 租赁期 这些 按照 稳定 期间 当时 其间 此期间 任期'.split(' '));
  const GROUP_COMMON = new Set('交易 支付 信息 章程 资金 往来 借款 担保 余额 款项 业务 采购 销售 租赁 股权 股份 资产 员工 董事 高管 人员 管理 经营 财务 治理 情况 名单 名称 数量 合计 控制权 现金流量表 资产负债表 利润表'.split(' '));
  function suspectRuleOk(r, grp, whole, after) {
    void whole; void after;
    if (r.why === '履历语境') {
      if (VERBISH.has(grp) || COMMON_2.has(grp) || LEAD_VERB.test(grp) || !nameRemainderOk(grp)) return false;
    } else if (r.why === '集团关系') {
      if (grp.length < 3 || GROUP_COMMON.has(grp) || LEAD_VERB.test(grp) || !nameRemainderOk(grp)) return false;
    } else if (r.why === '行业词尾') {
      if (LEAD_VERB.test(grp) || !nameRemainderOk(grp)) return false;
    }
    return true;
  }

  let usedAsStem = () => false;
  function suspectCandidates(text, spans, known, ignore) {
    usedAsStem = w => {
      let i = -1, n = 0;
      while ((i = text.indexOf(w, i + 1)) >= 0) {
        const nx = text.slice(i + w.length, i + w.length + 3);
        if (/^[\u4e00-\u9fa5]/.test(nx) && !SPEAK_NEXT.test(nx)) { if (++n >= 1) return true; }
      }
      return false;
    };
    let mx = text.length + 1;
    const cov = new Uint8Array(mx);
    for (const sp of spans) for (let i = Math.max(0, sp.start); i < Math.min(sp.end, mx); i++) cov[i] = 1;
    const covered = (st, en) => { for (let i = st; i < en; i++) if (cov[i]) return true; return false; };
    const found = new Map();
    const add = (x, type, why, weak) => {
      x = x.trim();
      if (!x || x.length < 2 || x.length > 20) return;
      if (/^\d+$/.test(x) || SUSPECT_BAD.test(x) || (type === 'ORG' && (ORG_STOP.has(x) || CITY_RE.test(x) || ITEM_BAD.test(x)))) return;
      if (/^[A-Za-z]/.test(x) && (EN_SUSPECT_BAD.test(x.split(/\s+/)[0]) || x.replace(/[^A-Za-z]/g, '').length < 3)) return;
      if (type === 'ORG' && /(?:额|比例|占比|情况|方式|说明|账号|任职|费用|成本|收入|利润|率|期间|年度|部分|内容|事项|单位|人员|部门)$/.test(x)) return;
      if (type === 'PERSON' && /^[\u4e00-\u9fa5]{2}$/.test(x) && COMMON_2.has(x)) return;
      if (/[于在将拟年月日的了着]$/.test(x)) return;
      if (/^(?:万|亿|股|份|元|千|百|余|约|共|每|该|本|其)/.test(x)) return;   // 万股股份 这类数量短语
      if (known.has(type + ':' + x) || ignore.has(x)) return;
      const k = type + ':' + x;
      if (type === 'ORG' && INDUSTRY_GENERIC.has(x)) return;
      if (type === 'PERSON' && /^[\u4e00-\u9fa5]{2}$/.test(x) && usedAsStem(x)) return;
      if (!found.has(k)) found.set(k, { alias: x, type, why, weak: !!weak, count: 0 });
    };
    for (const r of SUSPECT_RULES) {
      if (r.list) {
        // 名单规则：逐个"通过"取 80 字小窗口，窗口里有"持有"才匹配，避免长文本上的回溯爆炸
        let p = -1;
        const one = new RegExp(r.re.source);
        while ((p = text.indexOf('通过', p + 1)) >= 0) {
          const win = text.slice(p, p + 80);
          if (win.indexOf('持有') < 0) continue;
          const m = one.exec(win);
          if (!m || m.index !== 0) continue;
          const grp = m[1], base = p + m[0].indexOf(grp);
          let off = 0;
          for (const part of grp.split(/[、和及与]/)) {
            if (!part) continue;
            const st = base + grp.indexOf(part, off); off = st - base + part.length;
            if (!covered(st, st + part.length)) add(part, r.type, r.why, r.weak);
          }
        }
        continue;
      }
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(text)) !== null) {
        if (m[0].length === 0) { r.re.lastIndex++; continue; }
        const grp = m[1];
        const base = m.index + m[0].indexOf(grp);
        if (!suspectRuleOk(r, grp, m[0], text.substr(m.index + m[0].length, 4))) continue;
        if (!covered(base, base + grp.length)) add(grp, r.type, r.why, r.weak);
      }
    }
    // 出现次数：只数没被脱敏的位置
    const out = [];
    for (const c of found.values()) {
      let i = -1, n = 0;
      while ((i = text.indexOf(c.alias, i + 1)) >= 0) if (!covered(i, i + c.alias.length)) n++;
      if (n) { c.count = n; out.push(c); }
    }
    return out.sort((a, b) => b.count - a.count).slice(0, 200);
  }

  function resolveOverlaps(spans) {
    // 项目名里如果套着公司名（"华润万佳项目"），公司名优先——
    // 代号类型错了会让 AI 误判，而且公司名泄露风险更高
    // 用覆盖位图判断"项目是否压着机构"，避免 项目数 × 机构数 的平方级比对
    let orgCov = null;
    for (const s of spans) if (s.type === 'ORG') {
      if (!orgCov) { let mx = 0; for (const t of spans) if (t.end > mx) mx = t.end; orgCov = new Uint8Array(mx + 1); }
      for (let i = s.start; i < s.end; i++) orgCov[i] = 1;
    }
    const cleaned = spans.filter(s => {
      if (s.type !== 'PROJECT' || !orgCov) return true;
      for (let i = s.start; i < s.end; i++) if (orgCov[i]) return false;
      return true;
    });

    const arr = cleaned.sort((a, b) => {
      const la = a.end - a.start, lb = b.end - b.start;
      if (lb !== la) return lb - la;
      const pa = PRIO[a.type] || 0, pb = PRIO[b.type] || 0;
      if (pb !== pa) return pb - pa;
      if (b.conf !== a.conf) return b.conf - a.conf;
      return a.start - b.start;
    });
    // 用覆盖位图代替两两比较：从 O(n²) 降到 O(总跨度)
    let maxEnd = 0;
    for (const sp of arr) if (sp.end > maxEnd) maxEnd = sp.end;
    const cov = new Uint8Array(maxEnd + 1);
    const kept = [];
    for (const sp of arr) {
      const a = Math.max(0, sp.start), b = Math.min(sp.end, maxEnd);
      let clash = false;
      for (let i = a; i < b; i++) { if (cov[i]) { clash = true; break; } }
      if (clash) continue;
      for (let i = a; i < b; i++) cov[i] = 1;
      kept.push(sp);
    }
    return kept.sort((x, y) => x.start - y.start);
  }

  /* ---------------- 数值变换 ---------------- */
  function isParenNeg(x) { return /^[（(]/.test(x) && /[）)]$/.test(x); }

  function fmtNum(v, like) {
    // 财务报表惯例：(1,234) 表示 -1,234，输出时保持括号形式
    const paren = isParenNeg(like);
    if (paren) v = Math.abs(v);
    const bare = like.replace(/[（()）]/g, '');
    const dec = bare.indexOf('.') >= 0 ? bare.split('.')[1].length : 0;
    let s = v.toFixed(dec);
    if (bare.indexOf(',') >= 0) {
      const parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = parts.join('.');
    }
    if (dec === 0 && s.indexOf('.') >= 0) s = s.split('.')[0];
    return paren ? '(' + s + ')' : s;
  }

  function scaleAmount(numstr, factor) {
    const v = parseFloat(numstr.replace(/[（(),\s]/g, ''));
    if (isNaN(v)) return numstr;
    let nv = v * factor;
    const digits = numstr.replace(/[（(),\s]/g, '').replace('.', '').replace(/^0+/, '').length;
    if (digits <= 2) nv = parseFloat(nv.toPrecision(2));
    // 缩放后掉到个位数时，按整数格式化会四舍五入回原值（1 → 1），必须保留小数
    if (Math.abs(nv) < 10 && Math.abs(v) >= 1) {
      const paren = isParenNeg(numstr);
      const out = Math.abs(nv).toFixed(2);
      return paren ? '(' + out + ')' : out;
    }
    return fmtNum(nv, numstr);
  }

  function bucketAmount(numstr) {
    const v = parseFloat(numstr.replace(/,/g, ''));
    if (isNaN(v) || v === 0) return numstr;
    const mag = Math.pow(10, String(Math.trunc(Math.abs(v))).length - 1);
    const lo = Math.floor(v / mag) * mag;
    const hi = lo + mag;
    const f = n => n.toLocaleString('en-US');
    return f(lo) + '-' + f(hi);
  }

  // 规范化：128.6 / 128.60 / 128,600(千分位) 视为同一个数；
  // 但 128.6万 与 128.6亿 是不同量级，必须区分——所以单位参与 key。
  function canonNum(numstr, unit) {
    const neg = isParenNeg(numstr);
    const bare = numstr.replace(/[（(),\s]/g, '');
    const v = parseFloat(bare);
    if (isNaN(v)) return null;
    return (neg ? '-' : '') + String(v) + '\u0001' + (unit || '');
  }


  /* 掩码输出：识别与变换分离——识别结果不变，
     换一种"怎么遮"。适用于脱敏后直接发给外部看、不需要还原的场景。 */
  function maskToken(text, type) {
    const t = String(text);
    switch (type) {
      case 'PERSON': return t.slice(0, 1) + '*'.repeat(Math.max(1, t.length - 1));
      case 'PHONE': return '****' + t.slice(-4);
      case 'EMAIL': {
        const at = t.indexOf('@');
        return at > 0 ? t[0] + '***' + t.slice(at) : '***';
      }
      case 'IDCARD': case 'BANK': case 'USCC':
        return '****' + t.slice(-4);
      case 'ORG': return t.slice(0, 2) + '***';
      case 'ADDR': return t.slice(0, 6) + '***';
      case 'URL': case 'IP': return t.slice(0, 4) + '***';
      case 'PROJECT': return t.slice(0, 2) + '***';
      case 'CONTRACT': case 'INVOICE': case 'TICKER':
        return t.slice(0, 3) + '***';
      case 'PCT': return '**%';
      default: return '***';
    }
  }

  function idxLabel(i) {
    let s = '';
    i -= 1;
    while (true) {
      s = String.fromCharCode(65 + (i % 26)) + s;
      i = Math.floor(i / 26) - 1;
      if (i < 0) break;
    }
    return s;
  }

  const PY_PREFIX = {
    ORG: 'ORG', PERSON: 'PER', PROJECT: 'PRJ', MONEY: 'AMT', PCT: 'PCT',
    PHONE: 'TEL', IDCARD: 'ID', BANK: 'BANK', EMAIL: 'MAIL', ADDR: 'ADDR',
    SECRET: 'KEY', USCC: 'USCC', IP: 'IP', URL: 'URL', PLATE: 'CAR',
    TICKER: 'TKR', CONTRACT: 'NO', INVOICE: 'INV'
  };

  function tokenOf(type, idx, style, role) {
    const p = role || TYPES[type].prefix;
    const lab = idxLabel(idx);
    if (style === 'underscore') return '__' + PY_PREFIX[type] + '_' + lab + '__';
    if (style === 'plain') return p + lab;
    return '【' + p + lab + '】';
  }


  /* ================= 映射表加密 =================
     映射表就是一张"代号 ↔ 真名"的对照表，明文放在浏览器里，
     拿到电脑的人可以直接读出全部客户名。用口令加密后，
     没有口令就是一坨密文。
     PBKDF2-SHA256 派生密钥 → AES-256-GCM 加密，浏览器原生实现，无第三方库。
  */
  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(u8).toString('base64');
  }
  function fromB64(str) {
    if (typeof atob === 'function') {
      const s = atob(str);
      const u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  function hasSubtle() {
    return typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.deriveKey === 'function';
  }
  async function deriveKey(pw, salt) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* ---------------- 默认参数 ---------------- */
  const DEFAULT_OPTS = {
    mask_org: true, mask_person: true, mask_project: true,
    mask_money: true, mask_contact: true, mask_pct: false, mask_equity: true, date_shift: false,
    num_mode: 'scale', num_factor: 0.618, token_style: 'bracket',
    lex_groups: null, exclude: []
  };

  /* ---------------- 引擎 ---------------- */
  function blankProject(name) {
    return {
      name: name || '默认项目',
      map: {}, num: {}, numRaw: {}, unit: {},
      rules: [],
      factor: null, created: new Date().toISOString()
    };
  }

  function createEngine(storage) {
    const store = storage || null;
    const KEY = 'demask.vault.v1';

    // 按项目隔离：一个客户/一个项目一套映射。
    // 混在一起会导致三个问题——代号越编越靠后、导出映射把历史客户全带走、
    // 跨项目还原可能张冠李戴。
    let projects = {};
    let curId = null;
    let vault = blankProject();

    function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
    function flush() { if (curId && projects[curId]) projects[curId] = vault; }
    // 每个会话一个随机缩放因子：固定 0.618 等于把钥匙挂在门上
    function sessionFactor() {
      if (!vault.factor) {
        vault.factor = Math.round((0.55 + Math.random() * 0.2) * 1000) / 1000;
        save();
      }
      return vault.factor;
    }
    let dict = { ORG: [], PERSON: [], PROJECT: [] };

    let encOn = false;       // 存档是否加密
    let encKey = null;       // 解锁后驻留内存
    let encSalt = null;
    let locked = false;      // 加密但未解锁

    if (store) {
      try {
        const raw = store.getItem(KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (d && d.enc) {
            encOn = true; locked = true;
            encSalt = fromB64(d.salt);
          } else if (d && d.v === 3 && d.projects) {
            projects = d.projects;
            curId = (d.current && projects[d.current]) ? d.current : Object.keys(projects)[0];
            vault = projects[curId];
            if (d.dict) dict = Object.assign(dict, d.dict);
          } else if (d && d.map) {
            // 旧版扁平存档 → 包成一个项目，不丢数据
            const legacy = {
              name: '默认项目',
              map: d.map, num: d.num || {}, numRaw: d.numRaw || {}, unit: d.unit || {},
              factor: d.factor || null, created: d.created || new Date().toISOString()
            };
            curId = newId();
            projects = {}; projects[curId] = legacy;
            vault = legacy;
            if (d.dict) dict = Object.assign(dict, d.dict);
          }
        }
      } catch (e) { /* 忽略损坏的存档 */ }
    }

    if (!curId) {
      curId = newId();
      projects = {}; projects[curId] = vault;
    }

    let saveError = false;
    let saveTimer = null;

    function snapshot() {
      flush();
      return { v: 3, current: curId, projects: projects, dict: dict };
    }

    let lazySaveTimer = null;
    function scheduleSave() {
      if (!store) return;
      clearTimeout(lazySaveTimer);
      lazySaveTimer = setTimeout(save, 300);
      if (typeof addEventListener === 'function' && !scheduleSave.hooked) {
        scheduleSave.hooked = true;
        addEventListener('pagehide', () => { clearTimeout(lazySaveTimer); save(); });
      }
    }
    function save() {
      if (!store) return;
      // 加密但没解锁：绝不能把明文写回去覆盖密文
      if (encOn && !encKey) { saveError = true; return; }
      if (encOn) { scheduleEncryptedSave(); return; }
      try {
        store.setItem(KEY, JSON.stringify(snapshot()));
        saveError = false;
      } catch (e) { saveError = true; }
    }

    function scheduleEncryptedSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const data = new TextEncoder().encode(JSON.stringify(snapshot()));
          const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, encKey, data);
          store.setItem(KEY, JSON.stringify({
            v: 2, enc: 1, salt: toB64(encSalt), iv: toB64(iv), ct: toB64(new Uint8Array(ct))
          }));
          saveError = false;
        } catch (e) { saveError = true; }
      }, 300);
    }

    // 每类代号的计数：第一次用时数一遍，之后递增（以前每分配一个新代号都遍历整个映射表，代号上万时按平方变慢）
    // 映射表只在下面"分配代号"处新增条目；导入/切换项目会换成新的 map 对象，计数自然作废
    const idxCache = new WeakMap();
    function nextIndex(type, role) {
      const prefix = role || (TYPES[type] ? TYPES[type].prefix : '');
      let c = idxCache.get(vault.map);
      if (!c) { c = new Map(); idxCache.set(vault.map, c); }
      const key = type + '|' + prefix;
      if (!c.has(key)) {
        let n = 0;
        for (const k in vault.map) {
          const v = vault.map[k];
          if (v.type === type && v.token.indexOf('【' + prefix) === 0) n++;
        }
        c.set(key, n);
      }
      c.set(key, c.get(key) + 1);
      return c.get(key);
    }

    function numToken(numstr, o, unit) {
      const mode = o.num_mode;
      if (mode === 'keep') return numstr;
      if (mode === 'bucket') return bucketAmount(numstr);
      if (mode === 'hash') {
        let h = 0;
        for (let i = 0; i < numstr.length; i++) h = (h * 31 + numstr.charCodeAt(i)) >>> 0;
        const need = numstr.replace(/,/g, '').replace('.', '').length;
        let d = '';
        let x = h;
        while (d.length < need) { x = (x * 1103515245 + 12345) >>> 0; d += String(x % 10); }
        if (numstr.indexOf('.') >= 0) {
          const i = numstr.indexOf('.');
          d = d.slice(0, i) + '.' + d.slice(i);
        }
        return d;
      }
      const canon = canonNum(numstr, unit);
      if (canon === null) return numstr;
      const key = canon + '\u0001' + o.num_factor;
      if (!(key in vault.num)) {
        vault.num[key] = scaleAmount(numstr, o.num_factor);
        // 记下首次出现的原始写法，还原时按它输出（保持千分位/括号/小数位）
        if (!vault.numRaw) vault.numRaw = {};
        if (!(canon in vault.numRaw)) vault.numRaw[canon] = numstr;
      }
      return vault.num[key];
    }

    // 会话级设置：Office 导出、批量处理内部逐段调用 mask(plain) 时没有传 opts，
    // 以前会退回默认设置——界面上的"放行"和类型开关在导出文件里不生效。现在由界面同步进来。
    let sessionOpts = null;
    function setOpts(o) { sessionOpts = o ? Object.assign({}, o) : null; }

    function mask(text, opts) {
      const o = Object.assign({}, DEFAULT_OPTS, sessionOpts || {}, opts || {});
      if (!o.num_factor || o.num_factor === 'auto') o.num_factor = sessionFactor();
      if (o.num_mode === 'scale' && !o.fast) vault.usedFactor = o.num_factor;     // 还原 AI 推算的新数字时要用同一个系数
      let spans = [];

      spans = spans.concat(detectRegex(text), detectExtra(text));
      if (o.mask_project) spans = spans.concat(detectCodename(text));
      if (o.mask_org) spans = spans.concat(detectOrgList(text));
      spans = spans.concat(detectDocNo(text));
      if (vault.rules && vault.rules.length) spans = spans.concat(detectCustomRules(text, vault.rules));
      if (o.mask_org) {
        spans = spans.concat(detectOrgs(text));
        spans = spans.concat(detectLexicon(text, o.lex_groups));
        spans = spans.concat(dictFind(dict.ORG, text, 'ORG', '词库'));
        // 名单里的全称 → 自动认它的简称，并和全称拿同一个代号
        if (dict.ORG && dict.ORG.length) {
          let ex = dictAliasCache.get(dict.ORG);
          if (!ex || ex.n !== dict.ORG.length) {
            const words = [], canon = new Map();
            const own = new Set(dict.ORG);
            for (const w of dict.ORG) for (const a of deriveAliases(w)) if (!own.has(a) && !canon.has(a)) { canon.set(a, w); words.push(a); }
            ex = { n: dict.ORG.length, words: words, canon: canon };
            dictAliasCache.set(dict.ORG, ex);
          }
          for (const sp of dictFind(ex.words, text, 'ORG', '名单简称')) { sp.canon = ex.canon.get(sp.text); spans.push(sp); }
        }
      }
      if (o.mask_project) {
        spans = spans.concat(detectProjects(text));
        spans = spans.concat(dictFind(dict.PROJECT, text, 'PROJECT', '词库'));
      }
      if (o.mask_person) spans = spans.concat(detectPersons(text, dict), detectSpeakers(text), detectBioPersons(text), detectPlainNames(text));
      if (o.mask_org) spans = spans.concat(detectContextOrgs(text));
      if (o.mask_money) {
        spans = spans.concat(detectMoney(text));
        spans = spans.concat(detectCnMoney(text));
        spans = spans.concat(detectFinRows(text));
        spans = spans.concat(detectTables(text));
      }
      if (o.mask_pct) spans = spans.concat(detectPercent(text));
      if (o.date_shift) spans = spans.concat(detectDates(text));
      else if (vault.dateShiftUsed && !o.fast && DATE_RE.test(text)) { vault.dateShiftUsed = false; }
      DATE_RE.lastIndex = 0;
      if (o.mask_equity) spans = spans.concat(detectEquity(text));

      spans = resolveOverlaps(spans);

      // 简称归并（同一实体只用一个代号）
      // 它要做"每个机构 × 全文扫描"，只在小文档上跑；
      // 大文档靠词库和全称识别兜底，否则 10 万字会卡到几秒。
      if (o.mask_org) {
        const orgSpans = spans.filter(x => x.type === 'ORG');
        if (text.length <= 40000 && orgSpans.length <= 120) {
          let extra = mergeOrgAliases(text, orgSpans, spans);
          extra = extra.concat(detectHeadAliases(text, orgSpans, spans));
          extra = extra.concat(detectOrgContext(text, spans));
          extra = extra.concat(detectDeclaredAliases(text, spans));
          if (extra.length) spans = resolveOverlaps(spans.concat(extra));
        }
        detectRoles(text, spans);
      }

      // 全称推简称：文中出现过"深圳市鹏城智造科技有限公司"，别处单独写的"鹏城智造"（≥4 字）也换成同一个代号
      if (o.mask_org && !o.fast && text.length <= 400000) {
        const covered = new Uint8Array(text.length + 1);
        for (const sp of spans) for (let i = sp.start; i < sp.end; i++) covered[i] = 1;
        const add = [];
        const seen = new Set();
        for (const sp of spans) {
          if (sp.type !== 'ORG' || !ALIAS_SUFFIX.test(sp.text.replace(/\s/g, ''))) continue;
          for (const a of deriveAliases(sp.text.replace(/\s/g, ''))) {
            if (a.length < 4 || seen.has(a)) continue;
            seen.add(a);
            let i = -1;
            while ((i = text.indexOf(a, i + 1)) >= 0) {
              if (covered[i] || covered[i + a.length - 1]) continue;
              const x = Span(i, i + a.length, 'ORG', a, 0.85, '全称推简称');
              x.canon = sp.canon || sp.text;
              add.push(x);
              for (let k = i; k < i + a.length; k++) covered[k] = 1;
            }
          }
        }
        if (add.length) spans = resolveOverlaps(spans.concat(add));
      }

      // 同名扩散：不管机构开关，人名和组织都做（否则同一人只在名单里脱、正文里漏）
      if (text.length <= 40000 && spans.length <= 600) {
        const more = propagateNamed(text, spans);
        if (more.length) spans = resolveOverlaps(spans.concat(more));
      }

      // 角色回填：同一实体在别处有角色，这里也沿用
      if (o.mask_org) {
        const byCanon = {};
        for (const sp of spans) if (sp.role) byCanon[sp.canon || sp.text] = sp.role;
        for (const sp of spans) {
          if (!sp.role) {
            const r = byCanon[sp.canon || sp.text];
            if (r) sp.role = r;
          }
        }
      }

      // 类型开关
      spans = spans.filter(sp => {
        if (sp.type === 'ORG') return o.mask_org;
        if (sp.type === 'PERSON') return o.mask_person;
        if (sp.type === 'PROJECT') return o.mask_project;
        if (sp.type === 'MONEY') return o.mask_money;
        if (sp.type === 'PCT') return o.mask_pct || (o.mask_equity && /股权/.test(sp.note || ''));
        return o.mask_contact;
      });

      // 通用术语不当作机构（并购基金、产业基金、标的公司…）
      if (LEX.GENERIC && LEX.GENERIC.size) {
        spans = spans.filter(sp => !(sp.type === 'ORG' && LEX.GENERIC.has(sp.text)));
      }
      // 动词或引导词被吞进机构名："担任投资基金" / "开户行中国工商银行"
      for (const sp of spans) {
        if (sp.type !== 'ORG') continue;
        const mm = /^(?:开户行|开户银行|担任|任职于|任职|加入|就职于|供职于|曾任|现任|历任|兼任|毕业于|任|于|在)/.exec(sp.text);
        if (mm && sp.text.length - mm[0].length >= 4) { sp.start += mm[0].length; sp.text = sp.text.slice(mm[0].length); }
        else if (mm) sp._drop = true;
      }
      spans = spans.filter(sp => !sp._drop && !(sp.type === 'ORG' && LEX.GENERIC && LEX.GENERIC.has(sp.text)));
      // 泛指 + 机构后缀不是具体机构：客户证券账户 / 对方银行 / 本基金 / 某保险
      spans = spans.filter(sp => !(sp.type === 'ORG' && sp.text.length <= 6 &&
        /^(?:客户|我方|对方|本|该|其|各|某|相关|其他|主要|部分|多家|一家|这家|那家|境内|境外|国内|海外)/.test(sp.text)));

      // 手动放行
      if (o.exclude && o.exclude.length) {
        const ex = new Set(o.exclude);
        spans = spans.filter(sp => !ex.has(sp.type + ':' + sp.text));
      }

      // 简称候选（不自动脱敏，交给用户一键确认）
      let suggestions = [];
      if (o.mask_org && text.length <= 1000000 && !o.fast) {
        const dictOrg = dict.ORG || [];
        suggestions = aliasCandidates(text, spans.filter(s => s.type === 'ORG').slice(0, 150))
          .filter(x => dictOrg.indexOf(x.alias) < 0)
          .map(x => Object.assign(x, { type: 'ORG', why: '全称的简称' }));
      }
      if (text.length <= 1000000 && o.suspects !== false && !o.fast) {
        const known = new Set();
        for (const t of Object.keys(dict)) for (const w of dict[t] || []) known.add(t + ':' + w);
        for (const x of suggestions) known.add('ORG:' + x.alias);
        const ignore = new Set(o.ignore_suspects || []);
        for (const ex of o.exclude || []) ignore.add(String(ex).replace(/^[A-Z]+:/, ''));
        suggestions = suggestions.concat(suspectCandidates(text, spans, known, ignore));
      }
      if (suggestions.length > 200) suggestions = suggestions.slice(0, 200);

      // 人名别称归并：张总 → 张伟
      const persons = spans.filter(s => s.type === 'PERSON');
      const full = {};
      for (const p of persons) {
        if (p.text.length >= 2 && !/^.(?:总|经理|总监|先生|女士|老师)$/.test(p.text)) {
          if (!(p.text[0] in full)) full[p.text[0]] = p.text;
        }
      }
      for (const p of persons) {
        if (/^.(?:总|经理|总监|先生|女士|老师)$/.test(p.text) && p.text[0] in full) {
          p.text = full[p.text[0]];
        }
      }

      // 分配代号：canon（规范名）决定身份，text（表面形式）决定还原文本
      for (const sp of spans) {
        if (sp.type === 'DATE') continue;          // 日期平移不发代号
        const canon = sp.canon || sp.text;
        const ckey = sp.type + ':' + canon;
        const key = sp.type + ':' + sp.text;

        if (!(ckey in vault.map)) {
          vault.map[ckey] = {
            token: tokenOf(sp.type, nextIndex(sp.type, sp.role), o.token_style, sp.role),
            orig: canon, type: sp.type, role: sp.role || null
          };
        }
        const ent = vault.map[ckey];
        // 同一代号可能对应多个表面形式（全称/简称），还原时取最长的那个
        if (!(key in vault.map)) {
          vault.map[key] = { token: ent.token, orig: sp.text, type: sp.type, role: ent.role, n: 1 };
        } else {
          vault.map[key].n = (vault.map[key].n || 1) + 1;
          if (sp.text.length > vault.map[key].orig.length) vault.map[key].orig = sp.text;
        }
      }

      // 拼装
      const parts = [];
      const entities = [];
      let last = 0;
      for (const sp of spans) {
        parts.push(text.slice(last, sp.start));
        const ent = vault.map[sp.type + ':' + sp.text];
        let shown = ent ? ent.token : sp.text;
        if (o.token_style === 'mask') shown = maskToken(sp.text, sp.type);
        if (sp.type === 'DATE' && sp.date) {
          if (!vault.dateShift) { vault.dateShift = (Math.random() < 0.5 ? -1 : 1) * (37 + Math.floor(Math.random() * 140)); }
          const t = new Date(Date.UTC(sp.date.y, sp.date.mo - 1, sp.date.d + vault.dateShift));
          shown = fmtDate(t, sp.date.fmt);
          vault.dateShiftUsed = true;
          // 记住原文的补零习惯（2025/1/5 还是 2025/01/05），还原时照原样写回
          if (!sp.date.fmt.md) { if (!vault.datePad) vault.datePad = {}; vault.datePad[sp.date.fmt.sep1] = /^0|^\d{4}\D\d{2}\D\d{2}/.test(sp.text.replace(/^\d{4}/, '')) || /\D0\d/.test(sp.text); }
        } else if (sp.type === 'MONEY' && sp.cn && o.num_mode !== 'keep') {
          shown = numToken(sp.cn.num, o, sp.cn.unitWord.replace(/(美元|港元)$/, '') + (/(美元|港元)$/.test(sp.cn.unitWord) ? '' : '')) + sp.cn.unitWord;
          if (!vault.unit) vault.unit = {};
          if (!(shown in vault.unit)) vault.unit[shown] = sp.cn.unitWord;
        } else if (sp.type === 'MONEY' && o.num_mode !== 'keep' && /\d/.test(sp.text)) {
          const mu = text.slice(sp.end, sp.end + 8).match(/^\s*(十亿元|亿元|万元|千万元|百万元|十亿|百万|千万|亿|万|千元|元|million|billion|mn|bn)/i);
          const u = mu ? mu[1] : '';
          shown = numToken(sp.text, o, u);
          // 记住这个数字后面的单位，还原时用来判断"是不是同一个数"
          if (!vault.unit) vault.unit = {};
          if (!(shown in vault.unit)) vault.unit[shown] = u;
        }
        parts.push(shown);
        last = sp.end;
        entities.push(Object.assign({}, sp, { token: ent ? ent.token : shown, shown }));
      }
      parts.push(text.slice(last));
      const masked = parts.join('');

      // 导出 Office 时每个单元格都会调一次：不要每次都把整个映射表写一遍存储（会按平方变慢），攒一下再写
      if (o.fast) scheduleSave(); else save();
      return {
        masked, entities,
        stats: { chars: text.length, entities: entities.length, unique: new Set(entities.map(e => e.token)).size },
        residual: o.fast ? [] : riskScan(masked),
        reid: o.fast ? { level: 'low', dims: [] } : text.length <= 1000000 ? reidRisk(text) : { level: 'low', dims: [], note: '文本过长，未做再识别分析' },
        suggestions: suggestions,
        pseudo: o.fast ? [] : detectPseudo(text),
        vaultSize: o.fast ? -1 : Object.keys(vault.map).length
      };
    }

    // opt.mark = true 时返回 HTML，还原出来的部分用 <mark> 包起来，
    // 方便用户一眼看出"哪些是我换回去的"
    let lastRestore = { estimated: 0 };
    function restore(text, opt) {
      const mark = !!(opt && opt.mark);
      const MK_S = '\u0001', MK_E = '\u0002';
      // 内部一律加标记：后面要靠它区分"已还原"和"还没还原"的数字；最后按需要转成高亮或去掉
      const wrap = v => MK_S + v + MK_E;
      // 一个代号可能对应多种写法（全称/简称），还原时取"出现次数最多"的那个
      const best = {};
      for (const k in vault.map) {
        const v = vault.map[k];
        const cur = best[v.token];
        const n = v.n || 1;
        if (!cur || n > (cur.n || 1) || (n === (cur.n || 1) && v.orig.length > cur.orig.length)) {
          best[v.token] = { orig: v.orig, n: n };
        }
      }
      const rev = {};
      for (const t in best) rev[t] = best[t].orig;
      // 数值还原表：fake -> [{orig, unit}]
      // key 形如「数值\u0001单位\u0001因子」，所以同一数值的不同精度共用一条记录，
      // 不同量级（128.6万 / 128.6亿）分开记录。
      const numrev = {};
      for (const k in vault.num) {
        const p = k.split('\u0001');
        const val = p[0], unit = p[1] || '';
        const canon = val + '\u0001' + unit;
        const orig = (vault.numRaw && vault.numRaw[canon]) || val;
        const fake = vault.num[k];
        if (!fake) continue;
        (numrev[fake] = numrev[fake] || []).push({ orig: orig, unit: unit });
      }

      let out = text;
      // 日期平移打开时：回复里所有完整日期一次性反向平移（包括 AI 按平移后的日期推算出来的新日期）；
      // 关掉时不动日期。一次扫描完成，不会出现"换回来的日期又被当成另一个平移结果再换一次"
      if (vault.dateShift && vault.dateShiftUsed) {
        const sh = vault.dateShift;
        const spans = detectDates(out);
        if (spans.length) {
          let res = '', last = 0;
          for (const sp of spans.sort((x, y) => x.start - y.start)) {
            if (sp.start < last) continue;
            const t = new Date(Date.UTC(sp.date.y, sp.date.mo - 1, sp.date.d - sh));
            const f = Object.assign({}, sp.date.fmt);
            if (vault.datePad && !f.md && (f.sep1 in vault.datePad)) f.pad = vault.datePad[f.sep1];
            res += out.slice(last, sp.start) + wrap(fmtDate(t, f));
            last = sp.end;
          }
          out = res + out.slice(last);
        }
      }
      // 兼容 AI 的各种改写：全角/半角方括号、括号内空格、markdown 包裹
      const tokRe = /[【\[［〔]\s*([\u4e00-\u9fa5]{1,4}|IP)\s*([A-Z]{1,2}\d?)\s*[】\]］〕]/g;
      out = out.replace(tokRe, (m, p, lab) => {
        const key = '【' + p + lab + '】';
        return (key in rev) ? wrap(rev[key]) : m;
      });

      // 括号被完全吃掉的裸代号：企业A / 标的B
      const keys = Object.keys(rev).sort((a, b) => b.length - a.length);
      for (const tok of keys) {
        const bare = tok.replace(/^【|】$/g, '');
        if (!bare) continue;
        const re = new RegExp((/^[\u4e00-\u9fa5]/.test(bare) ? '(?<![A-Za-z])' : '(?<![A-Za-z0-9])') + bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'g');
        out = out.replace(re, () => wrap(rev[tok]));
      }
      out = out.replace(/__[A-Z]+_[A-Z0-9]+__/g, m => (m in rev ? wrap(rev[m]) : m));

      const escRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const UNIT_HEAD = /^\s*(?:十亿元|亿元|万元|千万元|百万元|十亿|百万|千万|亿|万|千元|元)/;

      const fakes = Object.keys(numrev).sort((a, b) => b.length - a.length);
      for (const fake of fakes) {
        if (!fake || fake.length < 2) continue;
        const cands = numrev[fake];
        // 后面紧跟数字/百分号，说明不是这个数（比率、编号），别动
        const re = new RegExp('(?<![\\d.,])' + escRe(fake) + '(?![\\d.,%％])', 'g');
        out = out.replace(re, (match, offset, whole) => {
          const after = whole.slice(offset + match.length, offset + match.length + 10);
          // 1) 单位对得上 → 就是它
          for (const c of cands) {
            if (c.unit && new RegExp('^\\s*' + escRe(c.unit)).test(after)) return wrap(c.orig);
          }
          // 2) 后面跟着别的单位 → AI 改了量纲，不还原，避免张冠李戴
          if (UNIT_HEAD.test(after)) {
            const nu = cands.find(c => !c.unit);
            return nu ? wrap(nu.orig) : match;
          }
          // 3) 没有单位：优先用原文也没单位的候选
          const nu = cands.find(c => !c.unit);
          return wrap((nu || cands[0]).orig);
        });
      }
      // AI 自己算出来的新金额（合计、差额、预测值……）不在对照表里，仍是缩放后的数：
      // 按同一个系数除回去，并单独标出来请用户核对（AI 引用的外部真实数字也会被除，所以必须提示）。
      // 只在这段文字确实来自脱敏稿时才做（命中过代号或已知假数），避免把已经还原的文字再除一次
      let estimated = 0;
      const f = vault.usedFactor || vault.factor;
      const hitAny = /\u0001/.test(out);
      if (f && hitAny && Object.keys(vault.num || {}).length && !(sessionOpts && sessionOpts.num_mode && sessionOpts.num_mode !== 'scale')) {
        const origSet = new Set(Object.values(vault.numRaw || {}).map(x => String(x).replace(/,/g, '')));
        const UNIT = '万亿元|十亿元|亿元|万元|千万元|百万元|千元|元|亿美元|万美元|美元|亿港元|万港元|港元|万亿|亿|万|million|billion|mn|bn|M|B';
        const NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
        const RE = new RegExp('((?:人民币|RMB|¥|￥|US\\$|HK\\$|\\$|美元|港币)\\s?)?(' + NUM + ')(?:(\\s*[-–—~～至到]\\s*)(' + NUM + '))?(\\s*)(' + UNIT + ')?(?![A-Za-z])', 'g');
        const conv = num => {
          const raw = num.replace(/,/g, ''), v = parseFloat(raw);
          let dec = (raw.split('.')[1] || '').length;
          const r = v / f;
          // 至少保留三位有效数字（"5 亿元"换回来是 8.1 而不是 8）
          const intDigits = String(Math.floor(Math.abs(r))).length;
          if (intDigits < 3) dec = Math.max(dec, Math.min(2, 3 - intDigits));
          let o = r.toFixed(dec);
          if (/,/.test(num)) o = o.replace(/^(-?\d+)/, x => x.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
          return o;
        };
        const parts = out.split(/(\u0001[\s\S]*?\u0002)/);
        for (let i = 0; i < parts.length; i++) {
          if (!parts[i] || parts[i][0] === '\u0001') continue;
          parts[i] = parts[i].replace(RE, (m0, cur, n1, dash, n2, sp, unit, off, whole) => {
            if (!cur && !unit) return m0;                                    // 没有币种也没有金额单位：不是金额
            if (/[\d.,%％]/.test(whole[off + m0.length] || '') || /[\d.]/.test(whole[off - 1] || '')) return m0;
            const nextCh = whole.slice(off + m0.length, off + m0.length + 2);
            if (unit === '元' && /^[旦宵素器件月]/.test(nextCh)) return m0;               // 元旦、元素、元器件
            if (/^(?:万亿|亿|万)$/.test(unit || '') && /^(?:家|人|户|个|次|台|件|名|辆|吨|用户|平|套|间|份|股|只|张|篇|条|座|所|位)/.test(nextCh)) return m0;
            if (/^(?:M|B)$/.test(unit || '') && !cur) return m0;                         // 100M 带宽：没有币种不算
            if (/^(?:万亿|亿|万)$/.test(unit || '') && !cur && !/(?:收入|营收|利润|金额|估值|成本|费用|资产|负债|市值|融资|投资|现金|预算|价格|销售额|合计|总计|差额|毛利|净额|余额|交易额|GMV|对价|出资|贷款|借款)/.test(whole.slice(Math.max(0, off - 14), off))) return m0;
            if (!unit && /^(?:19|20)\d{2}$/.test(n1)) return m0;
            if (unit === '元' && /^(?:19|20)\d{2}$/.test(n1)) return m0;                 // "2025元旦"
            // 已经是原值（用户把还原结果又贴了回来）：不再换
            if (origSet.has(n1.replace(/,/g, '')) && (!n2 || origSet.has(n2.replace(/,/g, '')))) return m0;
            const v1 = parseFloat(n1.replace(/,/g, ''));
            if (!isFinite(v1) || v1 === 0) return m0;
            estimated++;
            let res = (cur || '') + '\u0003' + conv(n1) + '\u0004';
            if (n2) res += dash + '\u0003' + conv(n2) + '\u0004';
            return res + sp + (unit || '');
          });
        }
        out = parts.join('');
      }
      lastRestore = { estimated: estimated };
      if (opt && opt.raw) return out;                // 保留内部标记，交给调用方（导出 Word 时标出推算值）
      if (mark) {
        out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                 .replace(/\u0001/g, '<mark class="rs">').replace(/\u0002/g, '</mark>')
                 .replace(/\u0003/g, '<mark class="rs est" title="AI 算出来的新数字，已按缩放系数换算回真实量级，请核对">').replace(/\u0004/g, '</mark>');
      } else {
        out = out.replace(/[\u0001-\u0004]/g, '');
      }
      return out;
    }


  /* ================= 再识别风险评估 =================
     面向文本场景的再识别风险评估。
     脱敏只替换了"名字"，没动"描述"。行业 + 地域 + 规模 + 结构特征
     这四个维度组合起来，在公开信息里往往唯一指向一家公司。
     所以不能只检查"还有没有手机号"，还要告诉用户"还剩多少线索"。
  */

  const REID_INDUSTRY = [
    '乳制品', '乳业', '常温奶', '低温奶', '奶粉', '白酒', '啤酒', '黄酒', '调味品', '酱油',
    '休闲食品', '零食', '饮料', '瓶装水', '餐饮', '连锁餐饮', '商超', '超市', '便利店', '百货',
    '电商', '跨境电商', '直播电商', '服装', '运动服饰', '家纺', '家电', '小家电', '家居', '家具',
    '化妆品', '美妆', '日化', '母婴', '宠物', '珠宝', '黄金珠宝',
    '光伏', '硅料', '组件', '风电', '储能', '动力电池', '锂电', '氢能', '电网', '火电', '水电',
    '核电', '煤炭', '石油', '天然气', '化工', '新材料', '钢铁', '水泥', '有色', '稀土',
    '汽车', '新能源车', '整车', '零部件', '轮胎', '工程机械', '机器人', '机床', '半导体', '芯片',
    '面板', '消费电子', '通信', '软件', '云计算', 'SaaS', '互联网', '人工智能',
    '医药', '创新药', 'CXO', '医疗器械', '疫苗', '中药', '连锁药店', '医院', '医美',
    '银行', '券商', '保险', '信托', '基金', '租赁', '担保', 'AMC',
    '地产', '物业', '建筑', '建材', '物流', '快递', '航空', '航运', '港口', '铁路',
    '教育', '旅游', '酒店', '传媒', '游戏', '影视', '广告', '营销',
    '农业', '养殖', '种业', '生猪', '饲料'
  ];

  const REID_REGION = [
    '华东', '华南', '华北', '华中', '西南', '西北', '东北', '长三角', '珠三角', '京津冀', '粤港澳',
    '一线城市', '二线城市', '下沉市场', '县域'
  ];

  const REID_CITY = [
    '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '武汉', '西安', '天津',
    '重庆', '宁波', '青岛', '长沙', '郑州', '合肥', '福州', '厦门', '济南', '沈阳', '大连',
    '无锡', '佛山', '东莞', '珠海', '中山', '温州', '泉州', '南通', '常州'
  ];

  function reidRisk(text) {
    const found = { industry: [], region: [], scale: [], structure: [] };
    const push = (k, v) => { if (v && found[k].indexOf(v) < 0) found[k].push(v); };

    // 行业：词表匹配，统计出现次数
    for (const w of REID_INDUSTRY) {
      if (text.indexOf(w) >= 0) push('industry', w);
    }
    // 地域：大区 + 城市
    for (const w of REID_REGION) if (text.indexOf(w) >= 0) push('region', w);
    for (const w of REID_CITY) if (text.indexOf(w) >= 0) push('region', w);

    // 规模：取文中最大的金额，换算量级
    let maxAmt = 0;
    const moneyRe = /(\d{1,3}(?:,\d{3}){0,5}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(万亿元|千亿元|百亿元|十亿元|亿元|万元|亿|万)/g;
    let mm;
    while ((mm = moneyRe.exec(text)) !== null) {
      const v = parseFloat(mm[1].replace(/,/g, ''));
      const mult = { '万亿元': 1e12, '千亿元': 1e11, '百亿元': 1e10, '十亿元': 1e9, '亿元': 1e8, '亿': 1e8, '万元': 1e4, '万': 1e4 }[mm[2]] || 1;
      if (v * mult > maxAmt) maxAmt = v * mult;
    }
    if (maxAmt >= 1e11) push('scale', '千亿级体量');
    else if (maxAmt >= 1e10) push('scale', '百亿级体量');
    else if (maxAmt >= 1e9) push('scale', '十亿级体量');
    else if (maxAmt >= 1e8) push('scale', '亿级体量');

    // 结构特征：这类数字比名字更能定位
    const st = [
      [/(\d[\d,]{0,15})\s*家(?:门店|店面|直营店|加盟店)/g, 'X 家门店'],
      [/门店\s*(?:数量|数)?\s*(?:为|达|约)?\s*(\d[\d,]{0,15})\s*家/g, 'X 家门店'],
      [/(\d[\d,.]{0,15})\s*万?人(?:的)?(?:员工|团队)/g, 'X 名员工'],
      [/市占率\s*(?:为|达|约)?\s*(\d{1,3}(?:\.\d+)?)\s*[%％]/g, 'X% 市占率'],
      [/(?:排名|位列)\s*第\s*([一二三四五六七八九十\d]+)/g, '行业排名第 X'],
      [/(\d[\d,]{0,15})\s*家(?:子公司|分公司|工厂|生产基地)/g, 'X 家分支/工厂'],
      [/(\d{1,3}(?:\.\d+)?)\s*[%％]\s*的?(?:线上|线下|华东|华南|海外)(?:占比|收入|营收)/g, 'X% 区域/渠道占比']
    ];
    for (const [re, label] of st) {
      const g = new RegExp(re.source, 'g');
      let m2;
      while ((m2 = g.exec(text)) !== null) {
        push('structure', label.replace('X', m2[1]));
        if (found.structure.length > 8) break;
      }
    }

    const dims = [];
    if (found.industry.length) dims.push({ key: 'industry', label: '行业', items: found.industry.slice(0, 4) });
    if (found.region.length) dims.push({ key: 'region', label: '地域', items: found.region.slice(0, 4) });
    if (found.scale.length) dims.push({ key: 'scale', label: '规模', items: found.scale });
    if (found.structure.length) dims.push({ key: 'structure', label: '结构特征', items: found.structure.slice(0, 5) });

    // 组合判定：行业 + 地域 + (规模或结构) 基本等于点名
    const has = k => dims.some(d => d.key === k);
    let level = 'low';
    if (has('industry') && has('region') && (has('scale') || has('structure'))) level = 'high';
    else if (has('industry') && has('structure')) level = 'high';
    else if (dims.length >= 2) level = 'mid';

    const notes = {
      high: '这几类线索组合起来，在公开信息里往往唯一指向一家企业——脱了名字，行研的人仍能反推',
      mid: '有 2 类线索，单独看不足以定位，但配合行业常识可能缩小到少数几家',
      low: '线索较少，反推风险不高'
    };

    return { level: level, dims: dims, note: notes[level] };
  }

    function riskScan(text) {
      const warn = [];
      const rules = [
        [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '疑似未处理手机号'],
        [/(?<!\d)\d{17}[\dXx](?!\d)/g, '疑似未处理身份证号'],
        // 本地部分限长 64：不限长时 5 万个连续字母会让这条正则退化成平方级（实测 1–2 秒）
        [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,10}/g, '疑似未处理邮箱'],
        [/机密|保密|内部资料|未经许可|禁止外传|confidential|internal only/gi, '文档含密级标识，建议同时去除'],
        [/(?<!\d)\d{16,19}(?!\d)/g, '疑似未处理长数字（账号）'],
        [/(?<![\w+])\+[1-9]\d{0,3}[\s-]?\d{2,5}[\s-]?\d{3,5}[\s-]?\d{0,5}(?!\d)/g, '疑似未处理国际电话'],
        [/(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|LTAI[A-Za-z0-9]{12,24}|AKID[A-Za-z0-9]{32}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})/g, '疑似未处理密钥'],
        [/(?:密码|口令|password|passwd)\s*[:：=]\s*(?![*•xX]{3,})\S{4,}/gi, '疑似未处理密码']
      ];
      const seen = new Set();
      for (const [re, msg] of rules) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          const k = msg + ':' + m.index;
          if (seen.has(k)) continue;      // 同一处只报一次（实测报告里"密级标识重复报"）
          seen.add(k);
          warn.push({ text: m[0].slice(0, 30), msg, pos: m.index });
          if (warn.length > 20) return warn;
        }
      }
      return warn;
    }

    function addWord(type, word, noSave) {
      if (!dict[type]) dict[type] = [];
      if (word && dict[type].indexOf(word) < 0) { dict[type].push(word); if (!noSave) save(); }
    }
    function flushSave() { save(); }
    function removeWord(type, word) {
      if (!dict[type]) return;
      const i = dict[type].indexOf(word);
      if (i >= 0) { dict[type].splice(i, 1); save(); }
    }
    function reset() {
      // 只清空当前项目，不动别的项目
      const keepName = vault.name;
      vault = blankProject(keepName);
      if (curId) projects[curId] = vault;
      save();
    }
    function exportVault() {
      return JSON.stringify({ map: vault.map, num: vault.num, numRaw: vault.numRaw || {}, unit: vault.unit || {}, dict, created: vault.created, factor: vault.factor, usedFactor: vault.usedFactor || null, dates: vault.dates || {}, dateShift: vault.dateShift || null }, null, 1);
    }
    function importVault(json) {
      const d = JSON.parse(json);
      if (!d || !d.map) throw new Error('格式不正确');
      vault = { map: d.map, num: d.num || {}, numRaw: d.numRaw || {}, unit: d.unit || {}, created: d.created || '', factor: d.factor || null, usedFactor: d.usedFactor || null, dates: d.dates || {}, dateShift: d.dateShift || null };
      if (d.dict) dict = Object.assign({ ORG: [], PERSON: [], PROJECT: [] }, d.dict);
      save();
    }
    function listVault() {
      return Object.keys(vault.map).map(k => vault.map[k]).sort((a, b) =>
        a.type === b.type ? a.token.localeCompare(b.token) : a.type.localeCompare(b.type));
    }

    return {
      mask, restore, riskScan, setOpts, flushSave,
      lastRestoreStats: () => lastRestore,
      addWord, removeWord, reset, exportVault, importVault, listVault,
      getDict: () => dict,
      getFactor: () => sessionFactor(),

      /* ---- 自定义规则 ---- */
      listRules() { return (vault.rules || []).slice(); },
      addRule(name, pattern, type, flags) {
        if (typeof pattern !== 'string' || !pattern || pattern.length > 300) throw new Error('规则为空或太长（最多 300 字符）');
        if (!Object.prototype.hasOwnProperty.call(TYPES, type) || type === 'DATE') throw new Error('不支持的类型：' + type);
        flags = String(flags || 'g').replace(/[^gimsuy]/g, '');
        if (flags.indexOf('g') < 0) flags += 'g';
        if (unsafeRegex(pattern)) throw new Error('规则里有嵌套的重复（例如 (\\d+)+ 或 (a|aa)+），遇到长文本会让页面卡死，请改写');
        try { new RegExp(pattern, flags); }
        catch (e) { throw new Error('正则语法有误：' + e.message); }
        if (!vault.rules) vault.rules = [];
        if (vault.rules.length >= 30) throw new Error('最多 30 条规则');
        vault.rules.push({
          id: 'r' + Date.now().toString(36),
          name: name || '自定义', pattern: pattern,
          type: type || 'ORG', flags: flags || 'g'
        });
        save();
        return true;
      },
      removeRule(id) {
        if (!vault.rules) return;
        const i = vault.rules.findIndex(r => r.id === id);
        if (i >= 0) { vault.rules.splice(i, 1); save(); }
      },

      // 表格单元格里的裸数字：没有单位、没有语境，由调用方判定"这一列是金额"后再缩放
      // 临时加入一批词（不保存），执行完再拿掉：Office 文件先通读全文学到的名字，用来保证各个部件里同名同代号
      async withTempWords(words, fn) {
        const added = [];
        for (const [t, w] of words) {
          if (!w) continue;
          if (!dict[t]) dict[t] = [];
          if (dict[t].indexOf(w) < 0) { dict[t].push(w); added.push([t, w]); }
        }
        try { return await fn(); }
        finally { for (const [t, w] of added) { const i = dict[t].indexOf(w); if (i >= 0) dict[t].splice(i, 1); } }
      },

      scaleNumber(numstr) {
        const o = Object.assign({}, DEFAULT_OPTS, { num_factor: sessionFactor() });
        return numToken(numstr, o, '');
      },

      /* ---- 项目管理 ---- */
      listProjects() {
        flush();
        return Object.keys(projects).map(id => ({
          id: id,
          name: projects[id].name || '未命名',
          entities: Object.keys(projects[id].map || {}).length,
          created: projects[id].created || '',
          current: id === curId
        })).sort((a, b) => (a.current ? -1 : b.current ? 1 : (b.created || '').localeCompare(a.created || '')));
      },
      currentProject() { return { id: curId, name: vault.name || '未命名' }; },

      // 这段文本里的代号，哪个项目能还原？换项目后忘了切回去时用来提示
      projectsCanRestore(text) {
        flush();
        const toks = new Set();
        const re = /[【\[［〔]\s*([\u4e00-\u9fa5]{1,4})\s*([A-Z]{1,2}\d?)\s*[】\]］〕]/g;
        let m;
        while ((m = re.exec(text)) !== null) toks.add('【' + m[1] + m[2] + '】');
        const out = [];
        if (!toks.size) return out;
        for (const id in projects) {
          const p = projects[id];
          const have = new Set(Object.keys(p.map || {}).map(k => p.map[k].token));
          let hit = 0;
          for (const t of toks) if (have.has(t)) hit++;
          if (hit > 0) out.push({ id: id, name: p.name || '未命名', hit: hit, total: toks.size, current: id === curId });
        }
        return out.sort((a, b) => b.hit - a.hit);
      },
      newProject(name) {
        flush();
        const id = newId();
        projects[id] = blankProject(name || ('项目 ' + new Date().toLocaleDateString('zh-CN')));
        curId = id; vault = projects[id];
        save();
        return id;
      },
      switchProject(id) {
        if (!projects[id]) throw new Error('项目不存在');
        flush();
        curId = id; vault = projects[id];
        save();
        return true;
      },
      renameProject(name) {
        vault.name = String(name || '').slice(0, 40) || '未命名';
        save();
        return true;
      },
      deleteProject(id) {
        if (Object.keys(projects).length <= 1) throw new Error('至少要保留一个项目');
        delete projects[id];
        if (curId === id) {
          curId = Object.keys(projects)[0];
          vault = projects[curId];
        }
        save();
        return true;
      },

      /* ---- 加密相关 ---- */
      cryptoAvailable: () => hasSubtle(),
      isEncrypted: () => encOn,
      isLocked: () => locked,

      async enableEncryption(pw) {
        if (!hasSubtle()) throw new Error('当前浏览器不支持加密接口');
        if (!pw || pw.length < 6) throw new Error('口令至少 6 位');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveKey(pw, salt);
        encSalt = salt; encKey = key; encOn = true; locked = false;
        scheduleEncryptedSave();
        return true;
      },

      async unlock(pw) {
        if (!hasSubtle()) throw new Error('当前浏览器不支持加密接口');
        const key = await deriveKey(pw, encSalt);
        const raw = JSON.parse(store.getItem(KEY));
        const ct = fromB64(raw.ct);
        let plain;
        try {
          plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(raw.iv) }, key, ct);
        } catch (e) {
          throw new Error('口令不对，或映射表已损坏');
        }
        const d = JSON.parse(new TextDecoder().decode(plain));
        vault = { map: d.map || {}, num: d.num || {}, unit: d.unit || {}, created: d.created || '', factor: d.factor || null };
        if (d.dict) dict = Object.assign({ ORG: [], PERSON: [], PROJECT: [] }, d.dict);
        encKey = key; locked = false;
        return true;
      },

      async disableEncryption() {
        if (!encOn) return true;
        if (!encKey) throw new Error('请先解锁');
        encOn = false; encKey = null; encSalt = null; locked = false;
        store.setItem(KEY, JSON.stringify(snapshot()));
        return true;
      },
      vaultSize: () => Object.keys(vault.map).length,
      saveFailed: () => saveError
    };
  }


  /* ================= 文件解析：docx / xlsx / pptx（纯浏览器 API） ================= */

  function unescapeHtml(str) {
    return String(str).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, function (m, e) {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      if (e === 'nbsp') return ' ';
      if (e[0] === '#') {
        const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(n) ? m : String.fromCodePoint(n);
      }
      return m;
    });
  }

  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 Office 文件');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nlen = dv.getUint16(off + 28, true);
      const elen = dv.getUint16(off + 30, true);
      const clen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(off + 46, off + 46 + nlen));
      const lnlen = dv.getUint16(lho + 26, true);
      const lelen = dv.getUint16(lho + 28, true);
      const ds = lho + 30 + lnlen + lelen;
      files[name] = { method: method, raw: u8.subarray(ds, ds + csize) };
      off += 46 + nlen + elen + clen;
    }
    return files;
  }

  async function inflateRaw(u8) {
    if (!u8.length) return new Uint8Array(0);
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function entryText(files, name) {
    const f = files[name];
    if (!f) return null;
    const bytes = f.method === 0 ? f.raw : await inflateRaw(f.raw);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function stripXml(xml) {
    let s = xml
      .replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n')
      .replace(/<\/a:p>/g, '\n').replace(/<\/w:tr>/g, '\n').replace(/<\/w:tc>/g, '\t');
    s = s.replace(/<[^>]+>/g, '');
    return unescapeHtml(s).replace(/\n{3,}/g, '\n\n').trim();
  }

  async function extractText(name, buf) {
    const low = String(name).toLowerCase();
    if (/\.(txt|md|csv|json|log|tsv)$/.test(low)) {
      const u8 = new Uint8Array(buf);
      for (const enc of ['utf-8', 'gb18030']) {
        try { return new TextDecoder(enc, { fatal: true }).decode(u8); } catch (e) { }
      }
      return new TextDecoder('utf-8').decode(u8);
    }
    if (/\.pdf$/.test(low)) {
      const P = (typeof DemaskPDF !== 'undefined') ? DemaskPDF : (typeof require === 'function' ? require('./pdf.js') : null);
      if (!P) throw new Error('PDF 模块未加载');
      const r = await P.extract(buf);
      return r.text;
    }
    if (!/\.(docx|xlsx|pptx)$/.test(low)) return null;

    const files = await unzip(buf);

    if (low.endsWith('.docx')) {
      return stripXml(await entryText(files, 'word/document.xml'));
    }
    if (low.endsWith('.pptx')) {
      const slides = Object.keys(files)
        .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
      const parts = [];
      for (let i = 0; i < slides.length; i++) {
        parts.push('—— 第 ' + (i + 1) + ' 页 ——\n' + stripXml(await entryText(files, slides[i])));
      }
      return parts.join('\n\n');
    }

    // xlsx
    const shared = [];
    if (files['xl/sharedStrings.xml']) {
      const sx = await entryText(files, 'xl/sharedStrings.xml');
      const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      let m;
      while ((m = re.exec(sx)) !== null) shared.push(unescapeHtml(m[1].replace(/<[^>]+>/g, '')));
    }
    const sheets = Object.keys(files)
      .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
    const out = [];
    for (let i = 0; i < sheets.length; i++) {
      out.push('—— 工作表 ' + (i + 1) + ' ——');
      const sx = await entryText(files, sheets[i]);
      const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
      let rm;
      while ((rm = rowRe.exec(sx)) !== null) {
        const cells = [];
        const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cm;
        while ((cm = cellRe.exec(rm[1])) !== null) {
          const attrs = cm[1], body = cm[2] || '';
          const tm = attrs.match(/\bt="(\w+)"/);
          const t = tm ? tm[1] : null;
          const vm = body.match(/<v>([\s\S]*?)<\/v>/);
          let val = '';
          if (vm) {
            val = vm[1];
            if (t === 's') {
              const idx = parseInt(val, 10);
              if (!isNaN(idx) && shared[idx] !== undefined) val = shared[idx];
            }
          } else {
            const im = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
            if (im) val = im[1];
          }
          cells.push(unescapeHtml(val));
        }
        if (cells.some(c => c.trim())) out.push(cells.join('\t'));
      }
    }
    return out.join('\n');
  }


  /* ================= Office 文件原地脱敏 =================
     把 docx/xlsx/pptx 解压 → 逐段脱敏 → 重新打包，
     这样交付出去的是保留原格式的 Word/Excel，而不是一堆 txt。
  */

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  }());

  function crc32(u8) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) crc = CRC_TABLE[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function deflateRaw(u8) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter();
      w.write(u8); w.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (e) { return null; }
  }

  async function writeZip(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
      const crc = crc32(data);
      let comp = data, method = 0;
      const z = await deflateRaw(data);
      if (z && z.length < data.length) { comp = z; method = 8; }

      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, method, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x21, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, comp.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, comp);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, comp.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + comp.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [eocd]));
  }

  function escapeXml(str) {
    return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // 按段落脱敏：Word 常把一个词拆成多个 <w:t>，逐节点替换会漏，
  // 所以先把整段文字拼起来脱敏，再写回第一个节点（其余清空）。
  // 代价是段内局部格式（加粗、颜色）会丢，段落结构、表格、样式都保留。
  function maskXmlParagraphs(xml, eng, stats) {
    // 文本框（w:txbxContent）嵌在段落里面，里面还有自己的段落：先单独处理再放回，
    // 否则外层段落会提前在文本框的 </w:p> 处截断，把文本框的字拼进正文
    if (xml.indexOf('<w:txbxContent') >= 0) {
      const boxes = [];
      let x = xml.replace(/<w:txbxContent\b[^>]*>[\s\S]*?<\/w:txbxContent>/g, b => {
        const open = b.match(/^<w:txbxContent\b[^>]*>/)[0];
        const inner = b.slice(open.length, -'</w:txbxContent>'.length);
        boxes.push(open + maskXmlParagraphsFlat(inner, eng, stats) + '</w:txbxContent>');
        return '\u0000TXBX' + (boxes.length - 1) + '\u0000';
      });
      x = maskXmlParagraphsFlat(x, eng, stats);
      return x.replace(/\u0000TXBX(\d+)\u0000/g, (m, i) => boxes[+i]);
    }
    return maskXmlParagraphsFlat(xml, eng, stats);
  }
  function maskXmlParagraphsFlat(xml, eng, stats) {
    return xml.replace(/<(w|a):p\b[^>]*>[\s\S]*?<\/\1:p>/g, para => {
      const inner = /<((?:w|a):t)\b[^>]*>([\s\S]*?)<\/\1>/g;
      const nodes = [];
      let m;
      while ((m = inner.exec(para)) !== null) {
        nodes.push({ tag: m[1], text: unescapeHtml(m[2]) });
      }
      if (!nodes.length) return para;
      const plain = nodes.map(n => n.text).join('');
      if (!plain.trim()) return para;

      const r = eng.mask(plain);
      if (!r.entities.length) return para;
      stats.paragraphs++;
      stats.entities += r.entities.length;

      let i = 0;
      return para.replace(inner, (mm, tag) => {
        const out = i === 0 ? escapeXml(r.masked) : '';
        i++;
        // 保留 xml:space="preserve"，否则首尾空格会被吃掉
        return '<' + tag + ' xml:space="preserve">' + out + '</' + tag + '>';
      });
    });
  }


  // Word 表格：按表头判断"哪一列是金额/人名"，再处理该列的数据行。
  // 表格里的数字没有单位、没有语境，只靠文本规则一个都抓不到。
  function cellTextOf(xml) {
    let out = '';
    const re = /<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) out += unescapeHtml(m[1]);
    return out;
  }

  function replaceCellText(cellXml, newText) {
    let first = true;
    return cellXml.replace(/<(w|a):t\b[^>]*>[\s\S]*?<\/\1:t>/g, (m, ns) => {
      const t = ns === 'w' ? '<w:t xml:space="preserve">' + (first ? escapeXml(newText) : '') + '</w:t>'
        : '<a:t>' + (first ? escapeXml(newText) : '') + '</a:t>';
      first = false;
      return t;
    });
  }

  const NUM_CELL_RE = /^[\s(（]*-?[\d,]+(?:\.\d+)?[\s)）]*$/;

  function isFinLabel(t) {
    const clean = String(t).replace(/[（(][^）)]*[）)]/g, '').replace(/[\s:：*]/g, '');
    return !!clean && FIN_ITEM.test(clean);
  }

  function maskXmlTables(xml, eng, stats) {
    // Word 的 w:tbl 和 PPT 的 a:tbl 结构相同，一起处理
    return xml.replace(/<(w|a):tbl\b[\s\S]*?<\/\1:tbl>/g, tbl => {
      const rows = [];
      const trRe = /<(?:w|a):tr\b[^>]*>[\s\S]*?<\/(?:w|a):tr>/g;
      let tm;
      while ((tm = trRe.exec(tbl)) !== null) rows.push({ start: tm.index, end: tm.index + tm[0].length, xml: tm[0] });

      const cells = [];
      const tcRe = /<(?:w|a):tc\b[^>]*>[\s\S]*?<\/(?:w|a):tc>/g;
      let cm;
      while ((cm = tcRe.exec(tbl)) !== null) {
        const pos = cm.index;
        let ri = -1;
        for (let i = 0; i < rows.length; i++) {
          if (pos >= rows[i].start && pos < rows[i].end) { ri = i; break; }
        }
        cells.push({ start: cm.index, end: cm.index + cm[0].length, xml: cm[0], row: ri });
      }
      if (!cells.length) return tbl;

      // 行内按出现顺序编号
      const byRow = {};
      for (const c of cells) {
        if (c.row < 0) continue;
        byRow[c.row] = byRow[c.row] || [];
        c.col = byRow[c.row].length;
        byRow[c.row].push(c);
      }

      // 两种常见表结构都要认：
      //   A 表头型：项目 | 2024A | 2025E  /  营业收入 | 128,600 | 152,300
      //   B 科目行型：营业收入 | 128,600
      // 所以列判定之外，还要按"这一行的首格是不是财务科目"逐行判断。
      const head = byRow[0] || [];
      const moneyCols = new Set(), nameCols = new Set();
      head.forEach(c => {
        const t = cellTextOf(c.xml);
        if (HEAD_MONEY.test(t)) moneyCols.add(c.col);
        if (HEAD_NAME.test(t)) nameCols.add(c.col);
      });



      // 从后往前替换，避免偏移错乱
      const todo = [];
      for (const c of cells) {
        // 第 0 行也要看：很多表是"科目 | 金额"两列，第一行就是数据
        if (c.col === undefined || c.col === 0) continue;
        const plain = cellTextOf(c.xml).trim();
        if (!plain) continue;
        // 表头里的年份列（2024 / 2025E）不是金额
        if (/^(?:19|20)\d{2}[AE]?$/.test(plain)) continue;
        const rowCells = byRow[c.row] || [];
        const label = rowCells.length ? cellTextOf(rowCells[0].xml).trim() : '';
        const finRow = c.col > 0 && isFinLabel(label);

        let next = null;
        if ((moneyCols.has(c.col) || finRow) && NUM_CELL_RE.test(plain)) {
          next = eng.scaleNumber(plain);
          if (next !== plain) { stats.cells = (stats.cells || 0) + 1; }
        } else if (nameCols.has(c.col)) {
          const r = eng.mask(plain);
          if (r.entities.length) next = r.masked;
        }
        if (next === null || next === plain) continue;
        todo.push({ start: c.start, end: c.end, xml: replaceCellText(c.xml, next) });
      }

      let out = tbl;
      for (let i = todo.length - 1; i >= 0; i--) {
        out = out.slice(0, todo[i].start) + todo[i].xml + out.slice(todo[i].end);
      }
      return out;
    });
  }

  // xlsx：共享字符串逐条脱敏；数字单元格按"列语义"判断是否缩放
  function maskXlsxShared(xml, eng, stats) {
    return xml.replace(/<si\b[^>]*>[\s\S]*?<\/si>/g, si => {
      const plain = unescapeHtml(si.replace(/<[^>]+>/g, ''));
      if (!plain.trim()) return si;
      const r = eng.mask(plain);
      if (!r.entities.length) return si;
      stats.paragraphs++;
      stats.entities += r.entities.length;
      // 丢掉原有 run 结构，整条写回（保留 si 上的属性）
      const open = si.match(/^<si\b[^>]*>/)[0];
      return open + '<t xml:space="preserve">' + escapeXml(r.masked) + '</t></si>';
    });
  }


  /* ---- xlsx 数字列：表头判定 + 公式保护 ---- */
  function colIndex(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseShared(xml) {
    const arr = [];
    if (!xml) return arr;
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml)) !== null) arr.push(unescapeHtml(m[1].replace(/<[^>]+>/g, '')));
    return arr;
  }

  // 单元格里的文字：共享字符串、内联字符串（t="inlineStr"）、公式字符串都要认
  function xlsxCellText(attrs, body, shared) {
    const tm = attrs.match(/\bt="(\w+)"/);
    const t = tm ? tm[1] : '';
    if (t === 'inlineStr') {
      let out = ''; const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let m;
      while ((m = re.exec(body)) !== null) out += unescapeHtml(m[1]);
      return out;
    }
    const vm = body.match(/<v>([\s\S]*?)<\/v>/);
    if (!vm) return '';
    if (t === 's') return shared[parseInt(vm[1], 10)] || '';
    return unescapeHtml(vm[1]);
  }

  function sheetHeadCols(xml, shared) {
    const money = new Set(), name = new Set();
    const hm = xml.match(/<row\b[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/);
    if (!hm) return { money, name };
    const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = re.exec(hm[1])) !== null) {
      const attrs = m[1], body = m[2] || '';
      const rm = attrs.match(/\br="([A-Z]+)\d+"/);
      if (!rm) continue;
      const col = colIndex(rm[1]);
      const text = xlsxCellText(attrs, body, shared);
      if (HEAD_MONEY.test(text)) money.add(col);
      if (HEAD_NAME.test(text)) name.add(col);
    }
    return { money, name };
  }

  function maskXlsxSheet(xml, shared, eng, stats) {
    const cols = sheetHeadCols(xml, shared);

    // 第一列常常是科目名（营业收入/营业成本…），金额列没有列名，
    // 所以还要按行判断：这一行的 A 列是财务科目，则该行其余数字都缩放。
    const rowLabel = {};
    const scanRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let sm;
    while ((sm = scanRe.exec(xml)) !== null) {
      const attrs = sm[1], body = sm[2] || '';
      const rm = attrs.match(/\br="([A-Z]+)(\d+)"/);
      if (!rm || rm[1] !== 'A') continue;
      rowLabel[rm[2]] = xlsxCellText(attrs, body, shared);
    }

    return xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (whole, attrs, body) => {
      if (!body) return whole;
      const rm = attrs.match(/\br="([A-Z]+)(\d+)"/);
      if (!rm) return whole;
      const col = colIndex(rm[1]), row = parseInt(rm[2], 10);
      if (row === 1 && !/<f\b/.test(body)) return whole;

      // 公式单元格：改了缓存值，Excel 一打开就会重算回真实数，改了等于没改
      // 公式单元格：公式本身不动（输入已经缩放，Excel 重算后自然是缩放后的结果）；
      // 但文件里存着上次计算的"缓存值"，不少工具（包括 AI 读表）直接读它——金额类的缓存值同样缩放
      if (/<f\b/.test(body)) {
        // 字符串公式的缓存结果（t="str"）：同样脱敏
        // 文字型公式的缓存结果（t="str"）：可能由单元格内容拼出客户名，又对不上缩放后的数——直接去掉，打开时重算
        if (/\bt="str"/.test(attrs)) {
          const sv = body.match(/<v>[\s\S]*?<\/v>/);
          if (sv) { stats.clean.formulaCache = (stats.clean.formulaCache || 0) + 1; return whole.replace(sv[0], ''); }
          return whole;
        }
        if (cols.money.has(col) || (col > 0 && isFinLabel(rowLabel[row] || ''))) {
          stats.formulas = (stats.formulas || 0) + 1;
          const fv = body.match(/<v>(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)<\/v>/);
          if (fv) {
            const sc = eng.scaleNumber(String(+fv[1])).replace(/,/g, '');
            return whole.replace('<v>' + fv[1] + '</v>', '<v>' + sc + '</v>');
          }
          return whole;
        }
        // 看不出是不是金额的公式：大于 100 的缓存值去掉（打开时 Excel 会重算），小的比率保留
        const fv = body.match(/<v>(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)<\/v>/);
        if (fv && Math.abs(+fv[1]) >= 100 && !/^(?:19|20)\d{2}$/.test(fv[1])) {
          stats.clean.formulaCache = (stats.clean.formulaCache || 0) + 1;
          return whole.replace('<v>' + fv[1] + '</v>', '');
        }
        return whole;
      }
      const tm = attrs.match(/\bt="(\w+)"/);
      if (tm && tm[1] === 's') return whole;   // 字符串走 sharedStrings
      if (tm && tm[1] === 'inlineStr') {       // 内联字符串：就地脱敏
        const plain = xlsxCellText(attrs, body, []);
        if (!plain.trim()) return whole;
        const r = eng.mask(plain);
        if (!r.entities.length) return whole;
        stats.paragraphs++; stats.entities += r.entities.length;
        return '<c' + attrs + '><is><t xml:space="preserve">' + escapeXml(r.masked) + '</t></is></c>';
      }

      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      if (!vm) return whole;
      const val = vm[1];
      if (!/^-?\d+(?:\.\d+)?$/.test(val)) return whole;
      // 图表里已经缩放过的数（内嵌在 PPT/Word 图表背后的表格）：按同一对照表替换，图和表保持一致
      if (stats.numMap && stats.numMap.has(String(+val)) && stats.fromChart) {
        stats.cells = (stats.cells || 0) + 1;
        return whole.replace('<v>' + val + '</v>', '<v>' + stats.numMap.get(String(+val)) + '</v>');
      }
      // 年份列 / 表头里的 2024、2025 不动
      if (/^(?:19|20)\d{2}$/.test(val)) return whole;
      const finRow = col > 0 && isFinLabel(rowLabel[row] || '');
      if (!cols.money.has(col) && !finRow) return whole;

      const scaled = eng.scaleNumber(val);
      if (scaled === val) return whole;
      stats.cells = (stats.cells || 0) + 1;
      if (stats.numMap) stats.numMap.set(String(+val), scaled.replace(/,/g, ''));
      return whole.replace('<v>' + val + '</v>', '<v>' + scaled.replace(/,/g, '') + '</v>');
    });
  }

  /* ---------------- Office 深度清理：正文以外的角落 ----------------
     元数据（作者、公司、标题）、批注与批注人、修订（含删除的原文）、页眉页脚、
     图表缓存、内嵌的 Excel/Word/PPT、超链接、图片替代文字、缩略图、工作表名、
     数据透视表缓存——这些地方都会把客户名带出去，正文脱敏了也白搭。 */
  const OFFICE_EXT = /\.(docx|xlsx|pptx|docm|xlsm|pptm)$/i;

  function maskPlain(eng, text, stats, key) {
    if (!text || !text.trim()) return text;
    const r = eng.mask(text);
    if (r.entities.length) { stats.entities += r.entities.length; if (key) stats.clean[key] = (stats.clean[key] || 0) + 1; }
    return r.masked;
  }
  // 把某个标签里的文字整体替换为脱敏结果（不做段落合并）
  function maskTagText(xml, tagRe, eng, stats, key) {
    return xml.replace(tagRe, (whole, open, inner, close) => {
      const plain = unescapeHtml(inner);
      const m = maskPlain(eng, plain, stats, key);
      return m === plain ? whole : open + escapeXml(m) + close;
    });
  }
  function maskAttr(xml, attrNames, eng, stats, key) {
    const re = new RegExp('\\b(' + attrNames.join('|') + ')="([^"]*)"', 'g');
    return xml.replace(re, (whole, an, val) => {
      const plain = unescapeHtml(val);
      const m = maskPlain(eng, plain, stats, key);
      return m === plain ? whole : an + '="' + escapeXml(m) + '"';
    });
  }
  // 批注人、修订人：统一换成"审阅人A/B…"，同一个人同一个代号
  function replaceAuthors(xml, authorMap, stats, attrs) {
    attrs = attrs || ['w:author', 'w:initials'];
    const pick = name => {
      if (!authorMap.has(name)) authorMap.set(name, '审阅人' + String.fromCharCode(65 + (authorMap.size % 26)) + (authorMap.size >= 26 ? Math.floor(authorMap.size / 26) : ''));
      return authorMap.get(name);
    };
    const re = new RegExp('(?<![\\w:])(' + attrs.join('|') + ')="([^"]*)"', 'g');
    xml = xml.replace(re, (whole, an, val) => {
      if (!val.trim()) return whole;
      stats.clean.authors = (stats.clean.authors || 0) + 1;
      if (/initials/i.test(an)) return an + '="R"';
      if (an === 'userId') return an + '=""';
      return an + '="' + escapeXml(pick(unescapeHtml(val))) + '"';
    });
    // xlsx 旧式批注：<authors><author>张伟</author></authors>
    xml = xml.replace(/<author>([\s\S]*?)<\/author>/g, (whole, val) => {
      stats.clean.authors = (stats.clean.authors || 0) + 1;
      return '<author>' + escapeXml(pick(unescapeHtml(val))) + '</author>';
    });
    return xml;
  }
  // 文档属性：作者、最后修改人清空；标题、主题、关键词、备注脱敏
  function cleanCoreProps(xml, eng, stats) {
    xml = xml.replace(/<(dc:creator|cp:lastModifiedBy)(\b[^>]*)>[\s\S]*?<\/\1>/g, (w, tag, at) => { stats.clean.meta = (stats.clean.meta || 0) + 1; return '<' + tag + at + '></' + tag + '>'; });
    return maskTagText(xml, /(<(?:dc:title|dc:subject|cp:keywords|dc:description|cp:category|cp:contentStatus)\b[^>]*>)([\s\S]*?)(<\/(?:dc:title|dc:subject|cp:keywords|dc:description|cp:category|cp:contentStatus)>)/g, eng, stats, 'meta');
  }
  function cleanAppProps(xml, eng, stats, sheetMap) {
    xml = xml.replace(/<(Company|Manager|HyperlinkBase)>[\s\S]*?<\/\1>/g, (w, tag) => { stats.clean.meta = (stats.clean.meta || 0) + 1; return '<' + tag + '></' + tag + '>'; });
    // 目录里列着工作表名 / 幻灯片标题
    return xml.replace(/(<vt:lpstr>)([\s\S]*?)(<\/vt:lpstr>)/g, (whole, o, inner, c) => {
      const plain = unescapeHtml(inner);
      if (sheetMap && sheetMap.has(plain)) return o + escapeXml(sheetMap.get(plain)) + c;
      const m = maskPlain(eng, plain, stats, 'meta');
      return m === plain ? whole : o + escapeXml(m) + c;
    });
  }
  // 图表缓存：文字脱敏；数字按"原值 → 缩放值"对照表替换（对照表来自同一文件里被缩放的单元格和金额）
  function maskChart(xml, eng, stats, numMap) {
    // 系列名是"营业收入 / 净利润"这类金额科目：整列数字按同一系数缩放，并记进对照表（内嵌表格随后按表替换）
    xml = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, ser => {
      const tx = (ser.match(/<c:tx>[\s\S]*?<\/c:tx>/) || [''])[0];
      const name = unescapeHtml(tx.replace(/<[^>]+>/g, ''));
      if (!(HEAD_MONEY.test(name) || isFinLabel(name)) || /率|占比|比例|增速|增长|%|％/.test(name)) return ser;
      return ser.replace(/(<c:val>[\s\S]*?<c:numCache>)([\s\S]*?)(<\/c:numCache>)/, (w, o, inner, c) =>
        o + inner.replace(/<c:v>([^<]*)<\/c:v>/g, (vw, v) => {
          if (!/^-?\d+(?:\.\d+)?$/.test(v)) return vw;
          const k = String(+v);
          if (!numMap.has(k)) numMap.set(k, eng.scaleNumber(v).replace(/,/g, ''));
          stats.clean.charts = (stats.clean.charts || 0) + 1;
          return '<c:v>' + numMap.get(k) + '</c:v>';
        }) + c);
    });
    xml = xml.replace(/(<c:strCache>)([\s\S]*?)(<\/c:strCache>)/g, (whole, o, inner, c) =>
      o + maskTagText(inner, /(<c:v>)([\s\S]*?)(<\/c:v>)/g, eng, stats, 'charts') + c);
    xml = maskTagText(xml, /(<a:t>)([\s\S]*?)(<\/a:t>)/g, eng, stats, 'charts');           // 图表标题、坐标轴标题
    xml = xml.replace(/(<c:numCache>)([\s\S]*?)(<\/c:numCache>)/g, (whole, o, inner, c) =>
      o + inner.replace(/<c:v>([^<]*)<\/c:v>/g, (w, v) => {
        const k = String(+v);
        if (numMap.has(k)) { stats.clean.charts = (stats.clean.charts || 0) + 1; return '<c:v>' + numMap.get(k) + '</c:v>'; }
        return w;
      }) + c);
    return xml;
  }
  // 数据透视表缓存里有一整份原始数据
  function maskPivot(xml, eng, stats, numMap) {
    xml = xml.replace(/<s v="([^"]*)"/g, (whole, val) => {
      const plain = unescapeHtml(val); const m = maskPlain(eng, plain, stats, 'pivot');
      return m === plain ? whole : '<s v="' + escapeXml(m) + '"';
    });
    return xml.replace(/<n v="([^"]*)"/g, (whole, v) => {
      const k = String(+v);
      return numMap.has(k) ? '<n v="' + numMap.get(k) + '"' : whole;
    });
  }
  // 超链接、外部链接：地址里常有邮箱、客户域名、带人名的文件路径
  function maskRels(xml, eng, stats) {
    return xml.replace(/<Relationship\b[^>]*>/g, rel => {
      if (!/TargetMode="External"/.test(rel) && !/externalLinkPath|hyperlink|attachedTemplate/.test(rel)) return rel;
      return rel.replace(/\bTarget="([^"]*)"/, (whole, val) => {
        const plain = decodeURIComponentSafe(unescapeHtml(val));
        // 本地路径里的用户名（C:/Users/zhangwei/…、/Users/zhangwei/…）
        let p2 = plain.replace(/((?:^|[\\/])(?:Users|home|Documents and Settings)[\\/])[^\\/]+/gi, '$1user');
        const m = maskPlain(eng, p2, stats, 'links');
        if (m === plain) return whole;
        stats.clean.links = (stats.clean.links || 0) + (m === p2 ? 1 : 0);
        // 换成合法的占位地址，避免严格的软件报"链接无效"
        let safe;
        if (/^mailto:/i.test(plain)) safe = 'mailto:redacted@example.invalid';
        else if (/^https?:/i.test(plain)) safe = 'https://example.invalid/' + encodeURIComponent(m.replace(/^https?:\/\//i, '')).slice(0, 120);
        else safe = m;
        return 'Target="' + escapeXml(safe) + '"';
      });
    });
  }
  function decodeURIComponentSafe(x) { try { return decodeURIComponent(x); } catch (e) { return x; } }
  // Word 修订里被删掉的原文（w:delText）不在正文里显示，但文件里还在
  function maskDelText(xml, eng, stats) {
    return xml.replace(/(<w:delText\b[^>]*>)([\s\S]*?)(<\/w:delText>)/g, (whole, o, inner, c) => {
      const plain = unescapeHtml(inner);
      const m = maskPlain(eng, plain, stats, 'revisions');
      return m === plain ? whole : '<w:delText xml:space="preserve">' + escapeXml(m) + c;
    });
  }
  // 工作表名、定义名称改名：名字里有客户名时整体换掉。
  // 改名后的名字必须唯一（两个表都叫"【企业A】"会让公式静默算错），引用它们的每个地方一起改。
  const NAME_CH = '[\\w.\\u4e00-\\u9fa5]';
  function uniqueName(base, used, maxLen) {
    let n = base.slice(0, maxLen), i = 2;
    while (used.has(n.toLowerCase())) { const suf = '_' + i++; n = base.slice(0, maxLen - suf.length) + suf; }
    used.add(n.toLowerCase());
    return n;
  }
  function buildRenames(wbXml, eng, stats) {
    const sheets = new Map(), names = new Map();
    const sheetList = [], nameList = [];
    wbXml.replace(/<sheet\b[^>]*\bname="([^"]*)"/g, (w, v) => { sheetList.push(unescapeHtml(v)); return w; });
    wbXml.replace(/<definedName\b[^>]*\bname="([^"]*)"/g, (w, v) => { nameList.push(unescapeHtml(v)); return w; });
    const usedS = new Set(), usedN = new Set();
    const plan = sheetList.map(o => { const m = eng.mask(o).masked; return [o, m]; });
    for (const [o, m] of plan) if (m === o) usedS.add(o.toLowerCase());          // 不改名的先占位
    for (const [o, m] of plan) {
      if (m === o) continue;
      const clean = m.replace(/[\\/?*\[\]:']/g, '').trim() || 'Sheet';
      sheets.set(o, uniqueName(clean, usedS, 31));
      stats.clean.sheets = (stats.clean.sheets || 0) + 1;
    }
    for (const o of nameList) if (!names.has(o)) {
      const m = eng.mask(o).masked;
      if (m === o) { usedN.add(o.toLowerCase()); continue; }
      names.set(o, null);
    }
    for (const o of names.keys()) {
      let m = eng.mask(o).masked.replace(/[^\w.一-龥]/g, '_').replace(/^([^A-Za-z_一-龥])/, '_$1').replace(/_+/g, '_');
      names.set(o, uniqueName(m, usedN, 255));
      stats.clean.names = (stats.clean.names || 0) + 1;
    }
    return { sheets, names };
  }
  // 改写一段公式（纯文本）：字符串字面量脱敏、表名引用（含 'A:B'! 三维引用）改名、定义名称按整词改名
  function rewriteFormula(text, R, eng, stats) {
    if (!text) return text;
    const mapSheet = s => R.sheets.has(s) ? R.sheets.get(s) : s;
    const refQuoted = inner => {          // 'X'! 或 'X:Y'!
      const parts = inner.replace(/''/g, "'").split(':');
      const mapped = parts.map(mapSheet);
      return mapped.some((p, i) => p !== parts[i]) ? "'" + mapped.join(':').replace(/'/g, "''") + "'!" : null;
    };
    // 按引号切段：双引号字符串、单引号表名、其余
    const segs = text.split(/("(?:[^"]|"")*"|'(?:[^']|'')*'!)/);
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      if (!sg) continue;
      if (sg[0] === '"') {
        let inner = sg.slice(1, -1).replace(/""/g, '"');
        // 字符串里写着表名引用（INDIRECT("'华润'!A1")）：只改名，不再脱敏，免得和表名对不上
        const re2 = inner.replace(/'((?:[^']|'')*)'!/g, (m, x) => refQuoted(x) || m)
          .replace(new RegExp('(^|[^' + NAME_CH.slice(1, -1) + "'])(" + NAME_CH + '+(?::' + NAME_CH + '+)?)!', 'g'), (m, pre, x) => { const r = refQuoted(x); return r ? pre + r : m; });
        if (re2 !== inner) inner = re2;
        else if (inner.trim() && !/^[一-龥]{0,4}(?:集团|公司|控股|股份|有限公司|股份有限公司|商业集团)$/.test(inner.trim())) { const mm = eng.mask(inner).masked; if (mm !== inner) { inner = mm; stats.clean.formulaText = (stats.clean.formulaText || 0) + 1; } }
        segs[i] = '"' + inner.replace(/"/g, '""') + '"';
      } else if (sg[0] === "'" && /'!$/.test(sg)) {
        const r = refQuoted(sg.slice(1, -2));
        if (r) segs[i] = r;
      } else {
        let x = sg.replace(new RegExp('(^|[^' + NAME_CH.slice(1, -1) + "])(" + NAME_CH + '+(?::' + NAME_CH + '+)?)!', 'g'), (m, pre, y) => { const r = refQuoted(y); return r ? pre + r : m; });
        if (R.names.size) {
          x = x.replace(new RegExp('(^|[^' + NAME_CH.slice(1, -1) + '])(' + NAME_CH + '+)(?![\\w.\\u4e00-\\u9fa5(!])', 'g'), (m, pre, id) => R.names.has(id) ? pre + R.names.get(id) : m);
        }
        segs[i] = x;
      }
    }
    return segs.join('');
  }
  function applyRenames(xmlText, R, eng, stats) {
    // 所有可能写公式或引用的地方
    let x = xmlText.replace(/(<(f|c:f|definedName|formula|formula1|formula2|xm:f|cfRule)\b[^>]*>)([^<]*)(<\/\2>)/g, (w, o, tag, inner, c) => {
      const plain = unescapeHtml(inner), r = rewriteFormula(plain, R, eng, stats);
      return r === plain ? w : o + escapeXml(r) + c;
    });
    x = x.replace(/\blocation="([^"]*)"/g, (w, v) => {         // 工作簿内部超链接
      const plain = unescapeHtml(v), r = rewriteFormula(plain, R, eng, stats);
      return r === plain ? w : 'location="' + escapeXml(r) + '"';
    });
    x = x.replace(/(<(?:sheet|definedName)\b[^>]*?\bname=")([^"]*)(")/g, (w, o, v, c) => {
      const plain = unescapeHtml(v);
      if (/^<sheet\b/.test(o) && R.sheets.has(plain)) return o + escapeXml(R.sheets.get(plain)) + c;
      if (/^<definedName\b/.test(o) && R.names.has(plain)) return o + escapeXml(R.names.get(plain)) + c;
      return w;
    });
    x = x.replace(/\bsheet="([^"]*)"/g, (w, v) => { const p = unescapeHtml(v); return R.sheets.has(p) ? 'sheet="' + escapeXml(R.sheets.get(p)) + '"' : w; });
    return x;
  }
  // 改完以后核对：旧名字在任何部件里都不能再出现（出现就说明有没覆盖到的引用，宁可不改名）
  function renamesLeft(outXmls, R) {
    for (const t of outXmls) {
      const d = unescapeHtml(t);
      for (const o of R.sheets.keys()) if (d.indexOf(o + '!') >= 0 || d.indexOf("'" + o.replace(/'/g, "''")) >= 0 || d.indexOf('"' + o + '"') >= 0) return o;
      for (const o of R.names.keys()) if (new RegExp('(^|[^\\w.\\u4e00-\\u9fa5])' + o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.\\u4e00-\\u9fa5(])').test(d.replace(/<[^>]+>/g, ' '))) return o;
    }
    return null;
  }

  /* ---------------- 规则包：客户名单 + 自定义规则 + 放行 / 忽略名单，一人维护、团队导入 ----------------
     可选口令加密（PBKDF2 20 万次 + AES-GCM）：规则包里是客户名单，本身就是敏感信息。 */
  const PACK_KIND = 'demask-rulepack';
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function packKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function buildRulePack(eng, extra, pass) {
    const dict = eng.getDict();
    const body = {
      kind: PACK_KIND, v: 1, name: (extra && extra.name) || eng.currentProject().name, created: new Date().toISOString(),
      dict: { ORG: (dict.ORG || []).slice(), PERSON: (dict.PERSON || []).slice(), PROJECT: (dict.PROJECT || []).slice() },
      rules: eng.listRules().map(r => ({ name: r.name, pattern: r.pattern, type: r.type, flags: r.flags })),
      exclude: (extra && extra.exclude) || [], ignore: (extra && extra.ignore) || []
    };
    const json = JSON.stringify(body);
    if (!pass) return JSON.stringify(body, null, 1);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, await packKey(pass, salt), new TextEncoder().encode(json)));
    return JSON.stringify({ kind: PACK_KIND + '-enc', v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
  }
  async function parseRulePack(text, pass) {
    let d;
    try { d = JSON.parse(text); } catch (e) { throw new Error('不是规则包文件'); }
    if (d && d.kind === PACK_KIND + '-enc') {
      if (!pass) { const e = new Error('这个规则包设了口令'); e.needPass = true; throw e; }
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(d.iv) }, await packKey(pass, unb64(d.salt)), unb64(d.ct));
        d = JSON.parse(new TextDecoder().decode(pt));
      } catch (e) { throw new Error('口令不对，或文件已损坏'); }
    }
    if (!d || d.kind !== PACK_KIND) throw new Error('不是规则包文件');
    const clean = a => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim().length >= 2 && x.length <= 60).map(x => x.trim()).slice(0, 20000) : [];
    return {
      name: String(d.name || ''), created: String(d.created || ''),
      dict: { ORG: clean(d.dict && d.dict.ORG), PERSON: clean(d.dict && d.dict.PERSON), PROJECT: clean(d.dict && d.dict.PROJECT) },
      rules: Array.isArray(d.rules) ? d.rules.filter(r => r && typeof r.pattern === 'string' && r.pattern.length <= 300 && typeof r.type === 'string' && Object.prototype.hasOwnProperty.call(TYPES, r.type)).map(r => ({ name: String(r.name || '自定义').slice(0, 40), pattern: r.pattern, type: r.type, flags: String(r.flags || 'g').replace(/[^gimsuy]/g, '') })).slice(0, 30) : [],
      exclude: clean(d.exclude), ignore: clean(d.ignore)
    };
  }
  // 合并进当前项目：已有的不重复加，返回新增数量
  function applyRulePack(eng, pack) {
    const dict = eng.getDict();
    const n = { ORG: 0, PERSON: 0, PROJECT: 0, rules: 0 };
    for (const t of ['ORG', 'PERSON', 'PROJECT']) for (const w of pack.dict[t]) if ((dict[t] || []).indexOf(w) < 0) { eng.addWord(t, w, true); n[t]++; }
    const have = new Set(eng.listRules().map(r => r.pattern + '\u0001' + r.type));
    for (const r of pack.rules) {
      if (have.has(r.pattern + '\u0001' + r.type)) continue;
      try { eng.addRule(r.name, r.pattern, r.type, r.flags); n.rules++; } catch (e) { /* 正则不合法或超过上限：跳过 */ }
    }
    if (eng.flushSave) eng.flushSave();
    return n;
  }

  async function partText(files, n) { return files[n] ? entryText(files, n) : null; }

  // 通读全文：先学到这个文件里所有的名字，再逐个部件替换，保证页眉里的"华润万佳"和正文里的全称拿同一个代号
  async function learnNames(files, eng) {
    let text = '';
    for (const n of Object.keys(files)) {
      if (!/\.xml$/.test(n) || /^\[Content_Types\]|_rels\//.test(n)) continue;
      if (/(theme|styles|settings|fontTable|webSettings|numbering|presProps|viewProps|tableStyles|calcChain)\d*\.xml$/.test(n)) continue;
      const xml = await entryText(files, n);
      if (!xml) continue;
      text += '\n' + unescapeHtml(xml.replace(/<\/(?:w:p|a:p|si|row|c:pt|comment)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' '));
      if (text.length > 600000) break;
    }
    const r = eng.mask(text);
    const words = [];
    // 作者、修改人、批注人的名字：正文里往往也会出现（"编制：张伟"），先记下来
    for (const n of Object.keys(files)) {
      if (!/^(docProps\/core|word\/comments|word\/people|ppt\/commentAuthors|ppt\/authors|xl\/comments\d*|xl\/persons\/person)/.test(n)) continue;
      const xml = await entryText(files, n);
      if (!xml) continue;
      const re = /(?:<dc:creator[^>]*>|<cp:lastModifiedBy[^>]*>|<author>|\b(?:w:author|name|displayName)=")([^<"]{2,30})/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const v = unescapeHtml(m[1]).trim();
        if (/^[\u4e00-\u9fa5]{2,4}$/.test(v) || /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/.test(v)) words.push(['PERSON', v]);
      }
    }
    for (const e of r.entities) {
      if (!/^(?:ORG|PERSON|PROJECT)$/.test(e.type)) continue;
      const t = e.text.replace(/\s+/g, '');
      if (t.length >= 2 && t.length <= 40) words.push([e.type, t]);
    }
    // Excel 里"联系人 / 负责人 / 经办人"这类列的单元格：像人名就记下来
    if (files['xl/workbook.xml']) {
      const shared = files['xl/sharedStrings.xml'] ? parseShared(await entryText(files, 'xl/sharedStrings.xml')) : [];
      for (const n of Object.keys(files)) {
        if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) continue;
        const xml = await entryText(files, n);
        const cols = sheetHeadCols(xml, shared);
        if (!cols.name.size) continue;
        xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (w, attrs, body) => {
          const rm = attrs.match(/\br="([A-Z]+)(\d+)"/);
          if (!rm || rm[2] === '1' || !cols.name.has(colIndex(rm[1]))) return w;
          const v = xlsxCellText(attrs, body || '', shared).trim();
          if (/^[\u4e00-\u9fa5]{2,4}$/.test(v) && looksLikeName(v, true) || /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/.test(v)) words.push(['PERSON', v]);
          return w;
        });
      }
    }
    // 简称候选（"华润万佳"是"华润万佳商业集团"的简称）：只收"全称的简称"这一类，最稳
    for (const x of (r.suggestions || [])) if (x.why === '全称的简称' && x.alias && x.alias.length >= 2) words.push(['ORG', x.alias]);
    return words;
  }

  async function maskOfficeFile(name, buf, engIn, ctx) {
    const low = String(name).toLowerCase();
    const eng = fastEngine(engIn);
    const files = await unzip(buf);
    const top = !ctx;
    ctx = ctx || { authorMap: new Map(), numMap: new Map(), depth: 0 };
    const stats = { paragraphs: 0, entities: 0, sheets: 0, clean: {}, warnings: [], numMap: ctx.numMap, fromChart: !!ctx.fromChart };
    const kind = /\.docx|\.docm/.test(low) ? 'docx' : /\.xlsx|\.xlsm/.test(low) ? 'xlsx' : /\.pptx|\.pptm/.test(low) ? 'pptx' : '';
    if (!kind) throw new Error('只支持 .docx / .xlsx / .pptx');

    const run = async (allowRename, skipNames) => {
      Object.assign(stats, { paragraphs: 0, entities: 0, clean: {}, warnings: [], cells: 0, formulas: 0 });
      const out = new Map();
      const put = (n, str) => out.set(n, new TextEncoder().encode(str));

      // xlsx：先缩放单元格（得到数字对照表），再处理图表和透视表
      let rawShared = [];
      let R = { sheets: new Map(), names: new Map() };
      const sheetMap = R.sheets;
      if (kind === 'xlsx') {
        if (files['xl/sharedStrings.xml']) rawShared = parseShared(await entryText(files, 'xl/sharedStrings.xml'));
        const wb = await partText(files, 'xl/workbook.xml');
        if (wb && allowRename !== false) {
          R = buildRenames(wb, eng, stats);
          for (const k of (skipNames || [])) { R.sheets.delete(k); R.names.delete(k); }
          sheetMap.clear(); for (const [k, v] of R.sheets) sheetMap.set(k, v); R.sheets = sheetMap;
          stats.clean.sheets = R.sheets.size || undefined; stats.clean.names = R.names.size || undefined;
        }
        stats.sheets = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length;
        for (const n of Object.keys(files)) {
          if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) continue;
          let xml = maskXlsxSheet(await entryText(files, n), rawShared, eng, stats);
          xml = maskTagText(xml, /(<(?:oddHeader|oddFooter|evenHeader|evenFooter|firstHeader|firstFooter)\b[^>]*>)([\s\S]*?)(<\/(?:oddHeader|oddFooter|evenHeader|evenFooter|firstHeader|firstFooter)>)/g, eng, stats, 'headers');
          xml = applyRenames(xml, R, eng, stats);
          put(n, xml);
        }
        if (files['xl/sharedStrings.xml']) put('xl/sharedStrings.xml', maskXlsxShared(await entryText(files, 'xl/sharedStrings.xml'), eng, stats));
        if (wb) {
          let x = applyRenames(wb, R, eng, stats);
          // 打开时强制重算，保证显示的都是用缩放后的输入算出来的结果
          if (/<calcPr\b/.test(x)) x = x.replace(/<calcPr\b([^>]*?)(\/?)>/, (w, a, sl) => '<calcPr' + a.replace(/\s*fullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"' + sl + '>');
          else x = x.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
          put('xl/workbook.xml', x);
        }
      }

      const order = Object.keys(files).sort((a, b) => (/\/charts\//.test(b) - /\/charts\//.test(a)) || (/\/embeddings\//.test(a) - /\/embeddings\//.test(b)));
      for (const n of order) {
        if (out.has(n)) continue;
        const f = files[n];
        // 缩略图：第一页的截图，直接删掉
        if (/^docProps\/thumbnail\.\w+$/.test(n)) { stats.clean.thumbnail = (stats.clean.thumbnail || 0) + 1; out.set(n, null); continue; }
        // 内嵌的 Office 文件：递归处理
        if (/\/embeddings\//.test(n) && OFFICE_EXT.test(n) && ctx.depth < 3) {
          const raw = f.method === 0 ? f.raw : await inflateRaw(f.raw);
          try {
            const sub = await maskOfficeFile(n, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length), eng, Object.assign({}, ctx, { depth: ctx.depth + 1, fromChart: true }));
            out.set(n, new Uint8Array(await sub.blob.arrayBuffer()));
            stats.entities += sub.stats.entities;
            stats.clean.embedded = (stats.clean.embedded || 0) + 1;
            for (const k of Object.keys(sub.stats.clean)) stats.clean[k] = (stats.clean[k] || 0) + sub.stats.clean[k];
          } catch (e) { stats.warnings.push('内嵌文件 ' + n.split('/').pop() + ' 无法处理'); }
          continue;
        }
        if (/\/embeddings\//.test(n)) { stats.warnings.push('有内嵌对象（' + n.split('/').pop() + '）无法检查，建议删除后再发'); }
        if (/\/media\/.*\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg)$/i.test(n)) stats.clean.images = (stats.clean.images || 0) + 1;
        if (!/\.(xml|rels)$/.test(n)) continue;
        let xml = await entryText(files, n);
        if (xml === null) continue;
        const orig = xml;

        if (n === 'docProps/core.xml') xml = cleanCoreProps(xml, eng, stats);
        else if (n === 'docProps/app.xml') xml = cleanAppProps(xml, eng, stats, sheetMap);
        else if (n === 'docProps/custom.xml') xml = maskTagText(xml, /(<vt:lpwstr>)([\s\S]*?)(<\/vt:lpwstr>)/g, eng, stats, 'meta');
        else if (/^customXml\/item\d+\.xml$/.test(n)) xml = maskTagText(xml, /(>)([^<>]+)(<)/g, eng, stats, 'meta');   // 业务系统写进文档的数据（客户、负责人……）
        else if (/\.rels$/.test(n)) {
          if (n === '_rels/.rels') xml = xml.replace(/<Relationship\b[^>]*Target="docProps\/thumbnail\.\w+"[^>]*\/>/g, '');
          xml = maskRels(xml, eng, stats);
        }
        else if (/\/charts\/chart\d+\.xml$/.test(n)) xml = applyRenames(maskChart(xml, eng, stats, ctx.numMap), R, eng, stats);
        else if (/pivotCache(Definition|Records)\d+\.xml$/.test(n)) xml = applyRenames(maskPivot(xml, eng, stats, ctx.numMap), R, eng, stats);
        else if (kind === 'docx' && /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|glossary\/document)\.xml$/.test(n)) {
          xml = maskXmlParagraphs(maskXmlTables(xml, eng, stats), eng, stats);
          xml = maskDelText(xml, eng, stats);
          // 域代码：HYPERLINK "mailto:…"、AUTHOR 张伟 这类藏在 instrText / fldSimple 里
          xml = maskTagText(xml, /(<w:instrText\b[^>]*>)([\s\S]*?)(<\/w:instrText>)/g, eng, stats, 'fields');
          xml = maskAttr(xml, ['w:instr'], eng, stats, 'fields');
          xml = maskAttr(xml, ['descr', 'title'], eng, stats, 'alt');
          xml = replaceAuthors(xml, ctx.authorMap, stats);
          if (/comments/.test(n)) stats.clean.comments = (stats.clean.comments || 0) + 1;
          if (/header|footer/.test(n)) stats.clean.headers = (stats.clean.headers || 0) + 1;
        }
        else if (kind === 'docx' && /^word\/(people|commentsExtended|commentsIds|commentsExtensible)\.xml$/.test(n)) xml = replaceAuthors(xml, ctx.authorMap, stats, ['w15:author', 'w15:userId', 'w:author']);
        else if (kind === 'pptx' && /^ppt\/(slides\/slide|notesSlides\/notesSlide|slideLayouts\/slideLayout|slideMasters\/slideMaster|notesMasters\/notesMaster|handoutMasters\/handoutMaster)\d+\.xml$/.test(n)) {
          xml = maskXmlParagraphs(maskXmlTables(xml, eng, stats), eng, stats);
          xml = maskAttr(xml, ['descr', 'title'], eng, stats, 'alt');
        }
        else if (kind === 'pptx' && /^ppt\/comments\/.*\.xml$/.test(n)) {
          xml = maskTagText(xml, /(<p:text>)([\s\S]*?)(<\/p:text>)/g, eng, stats, 'comments');
          xml = maskXmlParagraphs(xml, eng, stats);
          stats.clean.comments = (stats.clean.comments || 0) + 1;
        }
        else if (kind === 'pptx' && /^ppt\/(commentAuthors|authors)\.xml$/.test(n)) xml = replaceAuthors(xml, ctx.authorMap, stats, ['name', 'initials', 'userId']);
        else if (kind === 'xlsx' && /^xl\/comments\d*\.xml$|^xl\/comments\/.*\.xml$/.test(n)) {
          xml = maskTagText(xml, /(<t\b[^>]*>)([\s\S]*?)(<\/t>)/g, eng, stats, 'comments');
          xml = replaceAuthors(xml, ctx.authorMap, stats);
          stats.clean.comments = (stats.clean.comments || 0) + 1;
        }
        else if (kind === 'xlsx' && /^xl\/threadedComments\/.*\.xml$/.test(n)) {
          xml = maskTagText(xml, /(<text>)([\s\S]*?)(<\/text>)/g, eng, stats, 'comments');
          stats.clean.comments = (stats.clean.comments || 0) + 1;
        }
        else if (kind === 'xlsx' && /^xl\/persons\/.*\.xml$/.test(n)) xml = replaceAuthors(xml, ctx.authorMap, stats, ['displayName', 'userId']);
        else if (kind === 'xlsx' && /^xl\/(tables\/table|pivotTables\/pivotTable)\d+\.xml$/.test(n)) xml = applyRenames(xml, R, eng, stats);
        else if (kind === 'xlsx' && /^xl\/drawings\/drawing\d+\.xml$/.test(n)) {
          xml = maskXmlParagraphs(xml, eng, stats);           // 文本框、形状里的字
          xml = maskAttr(xml, ['descr', 'title'], eng, stats, 'alt');
        }
        if (xml !== orig) put(n, xml);
      }

      // 改名核对：还有旧名字残留，说明有没覆盖到的引用——放弃改名重做，保证文件不坏
      if (kind === 'xlsx' && (R.sheets.size || R.names.size)) {
        const texts = [];
        for (const n of Object.keys(files)) {
          if (!/\.(xml|rels)$/.test(n)) continue;
          if (out.has(n)) { const d = out.get(n); if (d) texts.push(new TextDecoder().decode(d)); }
          else texts.push(await entryText(files, n));
        }
        const left = renamesLeft(texts, R);
        if (left) {
          // 只放弃这一个名字，其余照常改名；放弃的名字一并提示
          const skip = (skipNames || []).concat(left);
          const r2 = skip.length > 12 ? await run(false) : await run(true, skip);
          if (!(skipNames || []).length) r2.stats.warnings.push('这些工作表名或定义名称里有客户名，但被较复杂的引用用到，为保证公式不出错没有改名，请在 Excel 里手动改名：' + (r2.stats.skipped || skip).join('、'));
          r2.stats.skipped = r2.stats.skipped || skip;
          return r2;
        }
      }
      // 写回：没改过的部件原样保留
      const entries = [];
      for (const n of Object.keys(files)) {
        if (out.has(n)) { const d = out.get(n); if (d) entries.push({ name: n, data: d }); continue; }
        const f = files[n];
        entries.push({ name: n, data: f.method === 0 ? f.raw : await inflateRaw(f.raw) });
      }
      // 文件名也在"学到的名字"范围内脱敏（"华润万佳尽调报告_v3" → "【企业A】尽调报告_v3"）
      if (top) {
        const base = String(name).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
        stats.maskedName = eng.mask(base).masked.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || '文件';
      }
      if (top && stats.clean.images) stats.warnings.push('文件里有 ' + stats.clean.images + ' 张图片，图片里的文字（截图、扫描件、logo）无法处理，请自己检查');
      return { blob: await writeZip(entries), stats: stats };
    };

    if (!top) return run(true);
    // 顶层：先通读全文学名字，再在"临时词库"下逐个部件替换
    const words = await learnNames(files, engIn);
    return engIn.withTempWords ? engIn.withTempWords(words, () => run(true)) : run(true);
  }
  // 部件、单元格往往成千上万：同一段文字只算一次，并跳过候选、再识别等分析（导出文件用不到）
  function fastEngine(eng) {
    if (eng.__fast) return eng;
    const cache = new Map();
    const f = Object.create(eng);
    f.__fast = true;
    f.mask = (t, o) => {
      if (o) return eng.mask(t, Object.assign({ fast: true }, o));
      if (cache.has(t)) return cache.get(t);
      const r = eng.mask(t, { fast: true });
      if (cache.size < 200000) cache.set(t, r);
      return r;
    };
    return f;
  }

  return {
    TYPES, createEngine, DEFAULT_OPTS, extractText, maskOfficeFile, writeZip, LEX, deriveAliases,
    buildRulePack, parseRulePack, applyRulePack,
    // 供测试使用
    _internal: { detectMoney, detectOrgs, detectPersons, detectFinRows, detectTables, resolveOverlaps, scaleAmount, detectLexicon, detectCodename, propagateNamed, detectRegex, detectDocNo, detectOrgList, detectEquity }
  };
}));
