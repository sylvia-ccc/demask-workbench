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
    INVOICE:  { label: '发票号',   prefix: '发票', color: 'sec' }
  };

  const PRIO = {
    IDCARD: 10, BANK: 10, SECRET: 10, USCC: 9, EMAIL: 9, PHONE: 8,
    ADDR: 7, URL: 6, IP: 6, PLATE: 6, TICKER: 9, CONTRACT: 9, INVOICE: 9,
    ORG: 5, PERSON: 5, PROJECT: 4, MONEY: 3, PCT: 1
  };

  /* ---------------- 词表 ---------------- */
  const SURNAMES =
    '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈' +
    '姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤' +
    '欧阳司马上官诸葛东方尉迟皇甫';

  const TITLE_SUFFIX = [
    '董事长', '总裁', '总监', '经理', '副总', '先生', '女士', '小姐', '老师', '博士', '教授',
    '主任', '院长', '处长', '局长', '部长', '主管', '负责人', '合伙人', '助理',
    '董事', '监事', '法人', '代表', '董秘',
    '总(?!额|计|体|部|数|量|比|价|成本|收入|支出|资产|负债|股本|市值|费用|利润|经理|裁|监|局|会|公司|的)',
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
  const NAME_BAD_PARTS = /公司|董事|监事|经理|总裁|职工|现任|任期|担任|兼任|执行|财务|采购|销售|独立|兼职|联席|办公室|委员会|集团|股份|有限|证券|银行|基金|上海|北京|深圳|广州|杭州|南京|成都|武汉|西安|苏州|天津|重庆|宁波|青岛|程序|关联|遴选|考核|评估|治理|结构|调整|运营|生产|研发|技术|质量|安全|环保|人力|行政|任职|副董|司副|^副|副$/;
  const COMPOUND_SURNAME = /^(?:欧阳|司马|上官|诸葛|东方|皇甫|尉迟|公孙|慕容|长孙|宇文|司徒|司空|夏侯|令狐|端木|独孤|南宫|西门|百里|东郭|呼延|羊舌|微生|梁丘|左丘|东门|南荣)$/;
  const COMPOUND_PAIRS = '欧阳 司马 上官 诸葛 东方 皇甫 尉迟 公孙 慕容 长孙 宇文 司徒 司空 夏侯 令狐 端木 独孤 南宫 西门 百里 东郭 呼延 羊舌 微生 梁丘 左丘 东门 南荣'.split(' ');

  // "欧阳楚英先生" 会被从"阳"开始匹配成"阳楚英"——候选前一个字若与首字构成复姓，说明切错了
  function cutInsideCompound(text, start, cand) {
    if (start <= 0) return false;
    const prev = text[start - 1];
    const two = prev + cand[0];
    return COMPOUND_PAIRS.indexOf(two) >= 0;
  }

  function looksLikeName(s) {
    if (!s || s.length < 2 || s.length > 4) return false;
    if (SURNAMES.indexOf(s[0]) < 0) return false;
    const BAD = ['高管', '高工', '高级', '方式', '方法', '方案', '成本', '成功', '成果',
      '金额', '金融', '历史', '周期', '周边', '于是', '余下', '徐缓', '王国', '马上'];
    if (BAD.indexOf(s) >= 0) return false;
    // 组织单元不是人名：华东大区 / 东大区 / 华南区域
    if (/大区|区域|片区|城市|省份|部门|事业部/.test(s)) return false;
    // 职务/机构词素不是人名：任公司 / 董事会 / 司职工 / 董事和
    if (NAME_BAD_PARTS.test(s)) return false;
    // 复姓单独出现（"欧阳"后面还有名）不当作完整人名
    if (COMPOUND_SURNAME.test(s)) return false;
    return true;
  }

  /* ---------------- 检测器：规则类 ---------------- */
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
    add(/\b([A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,4}\s+(?:Ltd\.?|Limited|Inc\.?|LLC|LLP|Corp\.?|Corporation|Group|Holdings|Partners|Capital|Fund|Bank|Securities))\b/g,
      'ORG', 0.85, null, '英文公司后缀');
    add(/(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g,
      'SECRET', 1, null, '');
    add(/(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;，；"']{4,}/gi, 'SECRET', 0.9, null, '');
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
    add(/(?:[\u4e00-\u9fa5]{2,8}(?:省|市|区|县|镇|乡|街道)){1,4}[\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:路|街|道|巷|弄|大厦|大楼|广场|园区)(?:[\u4e00-\u9fa5A-Za-z0-9]{1,10}(?:号|层|楼|室|单元))*/g,
      'ADDR', 0.85, null, '含路名');
    // 只有"数字+号"才算门牌，"招银叁号"这类不算
    // 城市 + 知名片区：上海张江 / 深圳南山 / 苏州工业园区
    add(/(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|宁波|青岛|长沙|郑州|合肥|福州|厦门|济南|沈阳|大连|无锡|佛山|东莞|珠海|中山)(?:市)?(?:张江|南山|前海|中关村|陆家嘴|亦庄|望京|金融城|科技园|高新区|经开区|自贸区|保税区|工业园区|开发区|软件园|科学城|办公室|办事处|分公司|总部)/g,
      'ADDR', 0.82, null, '城市+片区');
    add(/(?:[\u4e00-\u9fa5]{2,8}(?:省|市|区|县|镇|乡|街道)){1,4}[\u4e00-\u9fa5A-Za-z0-9]{2,20}\d+\s*号(?:[\u4e00-\u9fa5A-Za-z0-9]{1,10}(?:层|楼|室|单元))*/g,
      'ADDR', 0.85, null, '含门牌号');

    // 中文大写金额：人民币壹仟贰佰万元整
    add(/(?:人民币|RMB)?\s*([零壹贰叁肆伍陆柒捌玖拾佰仟万亿]{2,}(?:元|圆)(?:整)?)/g, 'MONEY', 0.9,
      s => /[拾佰仟万亿]/.test(s) || /人民币|RMB/.test(s), '大写金额');

    // 护照 / 港澳台通行证（必须有语境，避免误伤编号）
    add(/(?:护照|护照号|护照号码)\s*[:：]?\s*([A-Z]{1,2}\d{7,8})/g, 'IDCARD', 0.9, null, '语境');
    add(/(?:港澳?通行证|往来港澳通行证)(?:号|号码)?\s*[:：]?\s*([CW]\d{8})/g, 'IDCARD', 0.9, null, '语境');
    add(/(?:台胞证|台湾居民来往大陆通行证)(?:号|号码)?\s*[:：]?\s*(\d{8})/g, 'IDCARD', 0.9, null, '语境');

    // 股票代码：必须带交易所后缀，或紧邻"股票代码/证券代码"
    add(/\b(?:00|30|60|68|83|87|92)\d{4}\.(?:SZ|SH|BJ|sz|sh|bj)\b/g, 'TICKER', 0.95, null, '交易所后缀');
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

  function walkLeft(text, end, limit) {
    limit = limit || 30;
    let i = end;
    while (i > 0 && end - i < limit) {
      const c = text[i - 1];
      if (/\d/.test(c) || /\s/.test(c) || ORG_STOP_CHARS.has(c)) break;
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

  function detectOrgs(text) {
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
      if (prev && sp.start === prev.end && (sp.end - prev.start) <= 26) {
        prev.end = sp.end;
        prev.text = text.slice(prev.start, prev.end);
        prev.conf = Math.max(prev.conf, sp.conf);
      } else {
        merged.push(sp);
      }
    }
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
      out.push(Span(m.index, m.index + s.length, 'PROJECT', s, 0.7, '后缀识别'));
    }
    const re2 = /\b(?:Project|Proj\.?|Operation|Program)\s+([A-Z][A-Za-z0-9]{2,})/g;
    while ((m = re2.exec(text)) !== null) {
      out.push(Span(m.index, m.index + m[0].length, 'PROJECT', m[0], 0.85, '英文代号'));
    }
    return out;
  }

  /* ---------------- 检测器：人名 ---------------- */
  function detectPersons(text, dict) {
    const out = [];
    const re = (dict && dict.PERSON) || [];
    for (const name of re) {
      if (name.length < 2) continue;
      let i = -1;
      while ((i = text.indexOf(name, i + 1)) >= 0) {
        out.push(Span(i, i + name.length, 'PERSON', name, 1, '词库'));
      }
    }

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
    return out;
  }

  /* ---------------- 检测器：金额 ---------------- */
  const MONEY_RE = new RegExp(
    '(?<cur>人民币|RMB|CNY|USD|美元|美金|港币|HKD|欧元|EUR|¥|￥|\\$|€)?\\s*' +
    '(?<num>\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s*' +
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
  const ORG_LIST_LEAD = /(?:合作方为|合作方是|供应商为|供应商是|客户为|客户是|对方为|买方为|卖方为|甲方为|乙方为|交易对手为)\s*/g;
  const ORG_BODY = /([\u4e00-\u9fa5]{2,6}(?:科技|供应链|贸易|实业|控股|电子|材料|机械|食品|医药|网络|数据|软件|物流|传媒|能源|环保|建设|装饰|咨询|服务))/y;

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
     借鉴 Presidio 的 PatternRecognizer：词库只能覆盖"名字"，
     覆盖不了"编号格式"。咨询公司常有内部项目号、工号、合同号，
     格式固定，用正则一条就能覆盖。
  */

  function detectCustomRules(text, rules) {
    const out = [];
    if (!rules || !rules.length) return out;
    for (const r of rules) {
      if (!r || !r.pattern) continue;
      let re;
      try {
        re = new RegExp(r.pattern, r.flags || 'g');
      } catch (e) { continue; }   // 用户写的正则可能有语法错，跳过不崩
      let m, n = 0;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const val = (m[1] !== undefined && m[1] !== '') ? m[1] : m[0];
        const st = m.index + (val === m[0] ? 0 : m[0].indexOf(val));
        out.push(Span(st, st + val.length, r.type || 'ORG', val, 0.9, '规则:' + (r.name || '自定义')));
        if (++n >= 500) break;   // 防止写错的正则匹配爆炸
      }
    }
    return out;
  }

  function detectMoney(text) {
    const out = [];
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
      const qFrom = ne0 + (unit ? unit.length : 0);
      const quant = text.slice(qFrom, qFrom + 4);
      if (/^(?:人|家|个|台|辆|吨|平方米|平米|亩|间|所|条|次|位|张|套|批|只|件|箱|瓶|袋|支|片|克|千克|公斤|斤|升|毫升|度|小时|分钟|公里|千米|米|座|栋|层)/.test(quant)) continue;

      const v = parseFloat(digits);
      if (isNaN(v)) continue;
      const mult = UNIT_MULT[unit || ''] || 1;
      const real = v * mult;
      const ctx = text.slice(Math.max(0, ns0 - 14), ns0) + text.slice(ne0, ne0 + 14);
      const nearCtx = new RegExp(MONEY_CONTEXT, 'i').test(ctx);
      if (!(cur || unit || nearCtx)) continue;
      if (!(cur || unit) && real < 100) continue;

      out.push(Span(ns0, ne0, 'MONEY', num, 0.9, unit ? '含单位' : (cur ? '货币' : '语境')));
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
        let cnt = 0, idx = -1;
        while ((idx = text.indexOf(cand, idx + 1)) >= 0) {
          if (insideOrg(idx, cand.length)) continue;
          cnt++;
        }
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
        if (!text.startsWith(name, i)) continue;
        // 英文名要检查词边界，中文名不需要
        if (/[A-Za-z]$/.test(name)) {
          const prev = i > 0 ? text[i - 1] : '';
          const next = text[i + name.length] || '';
          if (/[A-Za-z]/.test(prev) || /[A-Za-z]/.test(next)) continue;
        }
        // 只有两字词歧义大（美的/大众/小米）；三字以上品牌名直接认
        if (name.length <= 2 && LEX.WEAK.has(name) && !weakContextOk(text, i, i + name.length)) continue;
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

    for (const [bs, be] of bounds) {
      const inSent = orgs.filter(o => o.start >= bs && o.end <= be);
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
      // 角色词就在实体名里（"金杜律师事务所"）——直接归它，别让邻居抢走
      for (const h of hits) {
        const owner = inSent.find(o => h.pos >= o.start && h.pos + h.len <= o.end);
        if (owner && !owner.role) { owner.role = h.key; used.add(h); }
      }
      for (const o of inSent) {
        let best = null, bd = 1e9;
        for (const h of hits) {
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
  function resolveOverlaps(spans) {
    // 项目名里如果套着公司名（"华润万佳项目"），公司名优先——
    // 代号类型错了会让 AI 误判，而且公司名泄露风险更高
    const orgRanges = spans.filter(s => s.type === 'ORG').map(s => [s.start, s.end]);
    const cleaned = spans.filter(s => {
      if (s.type !== 'PROJECT' || !orgRanges.length) return true;
      return !orgRanges.some(r => s.start < r[1] && s.end > r[0]);
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


  /* 掩码输出：借鉴 Presidio 的 operator 分离——识别结果不变，
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
    mask_money: true, mask_contact: true, mask_pct: false, mask_equity: true,
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

    function nextIndex(type, role) {
      const prefix = role || (TYPES[type] ? TYPES[type].prefix : '');
      let n = 0;
      for (const k in vault.map) {
        const v = vault.map[k];
        if (v.type === type && v.token.indexOf('【' + prefix) === 0) n++;
      }
      return n + 1;
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

    function mask(text, opts) {
      const o = Object.assign({}, DEFAULT_OPTS, opts || {});
      if (!o.num_factor || o.num_factor === 'auto') o.num_factor = sessionFactor();
      let spans = [];

      spans = spans.concat(detectRegex(text));
      if (o.mask_project) spans = spans.concat(detectCodename(text));
      if (o.mask_org) spans = spans.concat(detectOrgList(text));
      spans = spans.concat(detectDocNo(text));
      if (vault.rules && vault.rules.length) spans = spans.concat(detectCustomRules(text, vault.rules));
      if (o.mask_org) {
        spans = spans.concat(detectOrgs(text));
        spans = spans.concat(detectLexicon(text, o.lex_groups));
        for (const w of dict.ORG || []) {
          let i = -1;
          while ((i = text.indexOf(w, i + 1)) >= 0) spans.push(Span(i, i + w.length, 'ORG', w, 1, '词库'));
        }
      }
      if (o.mask_project) {
        spans = spans.concat(detectProjects(text));
        for (const w of dict.PROJECT || []) {
          let i = -1;
          while ((i = text.indexOf(w, i + 1)) >= 0) spans.push(Span(i, i + w.length, 'PROJECT', w, 1, '词库'));
        }
      }
      if (o.mask_person) spans = spans.concat(detectPersons(text, dict));
      if (o.mask_money) {
        spans = spans.concat(detectMoney(text));
        spans = spans.concat(detectFinRows(text));
        spans = spans.concat(detectTables(text));
      }
      if (o.mask_pct) spans = spans.concat(detectPercent(text));
      if (o.mask_equity) spans = spans.concat(detectEquity(text));

      spans = resolveOverlaps(spans);

      // 简称归并（同一实体只用一个代号）
      // 它要做"每个机构 × 全文扫描"，只在小文档上跑；
      // 大文档靠词库和全称识别兜底，否则 10 万字会卡到几秒。
      if (o.mask_org) {
        const orgSpans = spans.filter(x => x.type === 'ORG');
        if (text.length <= 40000 && orgSpans.length <= 120) {
          let extra = mergeOrgAliases(text, orgSpans, spans);
          extra = extra.concat(detectDeclaredAliases(text, spans));
          if (extra.length) spans = resolveOverlaps(spans.concat(extra));
        }
        detectRoles(text, spans);
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

      // 手动放行
      if (o.exclude && o.exclude.length) {
        const ex = new Set(o.exclude);
        spans = spans.filter(sp => !ex.has(sp.type + ':' + sp.text));
      }

      // 简称候选（不自动脱敏，交给用户一键确认）
      let suggestions = [];
      if (o.mask_org && text.length <= 200000) {
        const dictOrg = dict.ORG || [];
        suggestions = aliasCandidates(text, spans.filter(s => s.type === 'ORG').slice(0, 150))
          .filter(x => dictOrg.indexOf(x.alias) < 0);
      }

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
        let shown = ent.token;
        if (o.token_style === 'mask') shown = maskToken(sp.text, sp.type);
        if (sp.type === 'MONEY' && o.num_mode !== 'keep' && /\d/.test(sp.text)) {
          const mu = text.slice(sp.end, sp.end + 8).match(/^\s*(十亿元|亿元|万元|千万元|百万元|十亿|百万|千万|亿|万|千元|元|million|billion|mn|bn)/i);
          const u = mu ? mu[1] : '';
          shown = numToken(sp.text, o, u);
          // 记住这个数字后面的单位，还原时用来判断"是不是同一个数"
          if (!vault.unit) vault.unit = {};
          if (!(shown in vault.unit)) vault.unit[shown] = u;
        }
        parts.push(shown);
        last = sp.end;
        entities.push(Object.assign({}, sp, { token: ent.token, shown }));
      }
      parts.push(text.slice(last));
      const masked = parts.join('');

      save();
      return {
        masked, entities,
        stats: { chars: text.length, entities: entities.length, unique: new Set(entities.map(e => e.token)).size },
        residual: riskScan(masked),
        reid: text.length <= 200000 ? reidRisk(text) : { level: 'low', dims: [], note: '文本过长，未做再识别分析' },
        suggestions: suggestions,
        pseudo: detectPseudo(text),
        vaultSize: Object.keys(vault.map).length
      };
    }

    // opt.mark = true 时返回 HTML，还原出来的部分用 <mark> 包起来，
    // 方便用户一眼看出"哪些是我换回去的"
    function restore(text, opt) {
      const mark = !!(opt && opt.mark);
      const MK_S = '\u0001', MK_E = '\u0002';
      const wrap = v => mark ? (MK_S + v + MK_E) : v;
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
      // 兼容 AI 的各种改写：全角/半角方括号、括号内空格、markdown 包裹
      const tokRe = /[【\[［〔]\s*([\u4e00-\u9fa5]{1,4})\s*([A-Z]{1,2}\d?)\s*[】\]］〕]/g;
      out = out.replace(tokRe, (m, p, lab) => {
        const key = '【' + p + lab + '】';
        return (key in rev) ? wrap(rev[key]) : m;
      });

      // 括号被完全吃掉的裸代号：企业A / 标的B
      const keys = Object.keys(rev).sort((a, b) => b.length - a.length);
      for (const tok of keys) {
        const bare = tok.replace(/^【|】$/g, '');
        if (!bare) continue;
        const re = new RegExp('(?<![A-Za-z0-9])' + bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'g');
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
      if (mark) {
        out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                 .replace(/\u0001/g, '<mark class="rs">').replace(/\u0002/g, '</mark>');
      } else {
        out = out.replace(/[\u0001\u0002]/g, '');
      }
      return out;
    }


  /* ================= 再识别风险评估 =================
     借鉴 ARX 的 re-identification risk 思路，但适配文本场景。
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
    const moneyRe = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(万亿元|千亿元|百亿元|十亿元|亿元|万元|亿|万)/g;
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
      [/(\d[\d,]*)\s*家(?:门店|店面|直营店|加盟店)/g, 'X 家门店'],
      [/门店\s*(?:数量|数)?\s*(?:为|达|约)?\s*(\d[\d,]*)\s*家/g, 'X 家门店'],
      [/(\d[\d,.]*)\s*万?人(?:的)?(?:员工|团队)/g, 'X 名员工'],
      [/市占率\s*(?:为|达|约)?\s*(\d{1,3}(?:\.\d+)?)\s*[%％]/g, 'X% 市占率'],
      [/(?:排名|位列)\s*第\s*([一二三四五六七八九十\d]+)/g, '行业排名第 X'],
      [/(\d[\d,]*)\s*家(?:子公司|分公司|工厂|生产基地)/g, 'X 家分支/工厂'],
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
        [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '疑似未处理邮箱'],
        [/机密|保密|内部资料|未经许可|禁止外传|confidential|internal only/gi, '文档含密级标识，建议同时去除'],
        [/(?<!\d)\d{16,19}(?!\d)/g, '疑似未处理长数字（账号）']
      ];
      for (const [re, msg] of rules) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          warn.push({ text: m[0].slice(0, 30), msg, pos: m.index });
          if (warn.length > 20) return warn;
          if (m[0].length === 0) re.lastIndex++;
        }
      }
      return warn;
    }

    function addWord(type, word) {
      if (!dict[type]) dict[type] = [];
      if (word && dict[type].indexOf(word) < 0) { dict[type].push(word); save(); }
    }
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
      return JSON.stringify({ map: vault.map, num: vault.num, numRaw: vault.numRaw || {}, unit: vault.unit || {}, dict, created: vault.created, factor: vault.factor }, null, 1);
    }
    function importVault(json) {
      const d = JSON.parse(json);
      if (!d || !d.map) throw new Error('格式不正确');
      vault = { map: d.map, num: d.num || {}, numRaw: d.numRaw || {}, unit: d.unit || {}, created: d.created || '', factor: d.factor || null };
      if (d.dict) dict = Object.assign({ ORG: [], PERSON: [], PROJECT: [] }, d.dict);
      save();
    }
    function listVault() {
      return Object.keys(vault.map).map(k => vault.map[k]).sort((a, b) =>
        a.type === b.type ? a.token.localeCompare(b.token) : a.type.localeCompare(b.type));
    }

    return {
      mask, restore, riskScan,
      addWord, removeWord, reset, exportVault, importVault, listVault,
      getDict: () => dict,
      getFactor: () => sessionFactor(),

      /* ---- 自定义规则 ---- */
      listRules() { return (vault.rules || []).slice(); },
      addRule(name, pattern, type, flags) {
        try { new RegExp(pattern, flags || 'g'); }
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
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) out += unescapeHtml(m[1]);
    return out;
  }

  function replaceCellText(cellXml, newText) {
    let first = true;
    return cellXml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
      const t = '<w:t xml:space="preserve">' + (first ? escapeXml(newText) : '') + '</w:t>';
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
    return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, tbl => {
      const rows = [];
      const trRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
      let tm;
      while ((tm = trRe.exec(tbl)) !== null) rows.push({ start: tm.index, end: tm.index + tm[0].length, xml: tm[0] });

      const cells = [];
      const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
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
      const tm = attrs.match(/\bt="(\w+)"/);
      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      let text = '';
      if (tm && tm[1] === 's' && vm) text = shared[parseInt(vm[1], 10)] || '';
      else if (vm) text = vm[1];
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
      const tm = attrs.match(/\bt="(\w+)"/);
      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      if (tm && tm[1] === 's' && vm) rowLabel[rm[2]] = shared[parseInt(vm[1], 10)] || '';
      else if (vm) rowLabel[rm[2]] = vm[1];
    }

    return xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (whole, attrs, body) => {
      if (!body) return whole;
      const rm = attrs.match(/\br="([A-Z]+)(\d+)"/);
      if (!rm) return whole;
      const col = colIndex(rm[1]), row = parseInt(rm[2], 10);
      if (row === 1) return whole;

      // 公式单元格：改了缓存值，Excel 一打开就会重算回真实数，改了等于没改
      if (/<f\b/.test(body)) {
        if (cols.money.has(col) || (col > 0 && isFinLabel(rowLabel[row] || ''))) {
          stats.formulas = (stats.formulas || 0) + 1;
        }
        return whole;
      }
      const tm = attrs.match(/\bt="(\w+)"/);
      if (tm && tm[1] === 's') return whole;   // 字符串走 sharedStrings

      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      if (!vm) return whole;
      const val = vm[1];
      if (!/^-?\d+(?:\.\d+)?$/.test(val)) return whole;
      // 年份列 / 表头里的 2024、2025 不动
      if (/^(?:19|20)\d{2}$/.test(val)) return whole;
      const finRow = col > 0 && isFinLabel(rowLabel[row] || '');
      if (!cols.money.has(col) && !finRow) return whole;

      const scaled = eng.scaleNumber(val);
      if (scaled === val) return whole;
      stats.cells = (stats.cells || 0) + 1;
      return whole.replace('<v>' + val + '</v>', '<v>' + scaled.replace(/,/g, '') + '</v>');
    });
  }

  async function maskOfficeFile(name, buf, eng) {
    const low = String(name).toLowerCase();
    const files = await unzip(buf);
    const stats = { paragraphs: 0, entities: 0, sheets: 0 };
    const targets = [];

    if (low.endsWith('.docx')) {
      for (const n of Object.keys(files)) {
        if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n)) targets.push(n);
      }
    } else if (low.endsWith('.pptx')) {
      for (const n of Object.keys(files)) {
        if (/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n)) targets.push(n);
      }
    } else if (low.endsWith('.xlsx')) {
      if (files['xl/sharedStrings.xml']) targets.push('xl/sharedStrings.xml');
      stats.sheets = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length;
    } else {
      throw new Error('只支持 .docx / .xlsx / .pptx');
    }

    // xlsx 的数字列判定要用"脱敏前"的表头文字
    let rawShared = [];
    if (low.endsWith('.xlsx') && files['xl/sharedStrings.xml']) {
      rawShared = parseShared(await entryText(files, 'xl/sharedStrings.xml'));
    }

    const out = [];
    for (const n of Object.keys(files)) {
      const f = files[n];
      let data = f.raw;
      if (targets.indexOf(n) >= 0) {
        const xml = await entryText(files, n);
        const maskedXml = n === 'xl/sharedStrings.xml'
          ? maskXlsxShared(xml, eng, stats)
          : maskXmlParagraphs(maskXmlTables(xml, eng, stats), eng, stats);
        data = new TextEncoder().encode(maskedXml);
      } else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) {
        const xml = await entryText(files, n);
        data = new TextEncoder().encode(maskXlsxSheet(xml, rawShared, eng, stats));
      } else if (f.method !== 0) {
        data = await inflateRaw(f.raw);
      }
      out.push({ name: n, data: data });
    }

    const blob = await writeZip(out);
    return { blob: blob, stats: stats };
  }

  return {
    TYPES, createEngine, DEFAULT_OPTS, extractText, maskOfficeFile, writeZip, LEX,
    // 供测试使用
    _internal: { detectMoney, detectOrgs, detectPersons, detectFinRows, detectTables, resolveOverlaps, scaleAmount, detectLexicon, detectCodename, propagateNamed, detectRegex, detectDocNo, detectOrgList, detectEquity }
  };
}));
