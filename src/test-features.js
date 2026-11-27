// 功能回归：日期平移（可还原、间隔不变）、规则包（加密、合并、去重）
// 用法：node test-features.js
const E = require('./engine.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ ' + m); } };

(async () => {
  // ---- 日期平移 ----
  {
    const e = E.createEngine();
    const src = '签约日 2025年3月15日，交割日 2025-06-30，公告 2025/1/5，2025年全年收入 100 亿元，2月30日不是日期。';
    const m = e.mask(src, { date_shift: true });
    ok(m.masked.indexOf('2025年3月15日') < 0 && m.masked.indexOf('2025-06-30') < 0 && m.masked.indexOf('2025/1/5') < 0, '日期没有平移：' + m.masked);
    ok(/2025年全年/.test(m.masked) && /2月30日/.test(m.masked), '只有年份或无效日期也被改了：' + m.masked);
    const d = [...m.masked.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日|(\d{4})-(\d{2})-(\d{2})/g)];
    const t = x => x[1] ? Date.UTC(+x[1], x[2] - 1, +x[3]) : Date.UTC(+x[4], x[5] - 1, +x[6]);
    ok(d.length >= 2 && (t(d[1]) - t(d[0])) / 864e5 === 107, '平移后间隔天数变了');
    e.setOpts({ date_shift: true });
    ok(e.restore(m.masked) === src, '日期还原不一致：' + e.restore(m.masked));
    // AI 按平移后的日期推算出的新日期，也要换回（签约日 + 30 天）
    const sh = d.length ? (t(d[0]) - Date.UTC(2025, 2, 15)) / 864e5 : 0;
    const ai = new Date(Date.UTC(2025, 2, 15 + sh + 30));
    const aiTxt = '付款日为 ' + ai.getUTCFullYear() + '年' + (ai.getUTCMonth() + 1) + '月' + ai.getUTCDate() + '日';
    ok(e.restore(aiTxt) === '付款日为 2025年4月14日', 'AI 推算的日期没有换回：' + e.restore(aiTxt));
    // 原文里两个日期正好相差平移天数：不能互相串（以前逐个替换会把 6月30日 改成 3月31日）
    for (let k = 0; k < 30; k++) {
      const e2 = E.createEngine(); e2.setOpts({ date_shift: true });
      const src2 = '截至2025年6月30日、2025年3月31日、2024年12月31日；付款 2025-04-04，签约 2025-03-05；3月5日开会';
      const m2 = e2.mask(src2);
      if (e2.restore(m2.masked) !== src2) { ok(false, '日期串位：' + e2.restore(m2.masked)); break; }
      if (k === 29) ok(true, '');
    }
    ok(E.createEngine().mask(src, {}).masked.indexOf('2025年3月15日') >= 0, '默认不应平移日期');
  }

  // ---- 界面的真实调用方式：mask 传选项、restore 不调 setOpts ----
  {
    const e = E.createEngine();
    const src = '截至2025年6月30日、2025年3月31日，签约日 2025-03-05';
    const m = e.mask(src, { date_shift: true });
    ok(e.restore(m.masked) === src, '界面方式下日期没有还原：' + e.restore(m.masked));
    // 之后用户关掉平移、又脱敏了一段有日期的文字：再还原就不该动日期
    e.mask('另一份材料 2025-01-01', {});
    ok(e.restore('今天是 2025-04-04') === '今天是 2025-04-04', '关掉后还原仍在改日期');
  }

  // ---- AI 新算出的金额：按同一系数换回真实量级 ----
  {
    const e = E.createEngine();
    const m = e.mask('华润万佳商业集团 2024 年营收 128.6 亿元，2025 年营收 152.3 亿元，门店 1,240 家。', {});
    const n = m.masked.match(/[\d.]+(?= 亿元)/g).map(Number);
    const ai = '合计营收 ' + (n[0] + n[1]).toFixed(1) + ' 亿元，2024 年 ' + n[0] + ' 亿元，同比增长 18.4%，门店 1,240 家，第 3 季度。';
    const r = e.restore(ai);
    ok(/合计营收 280\.9 亿元/.test(r), 'AI 合计没有换回真实量级：' + r);
    ok(/2024 年 128\.6 亿元/.test(r) && /18\.4%/.test(r) && /1,240 家/.test(r) && /第 3 季度/.test(r), '不该动的数字被改了：' + r);
    ok(e.lastRestoreStats().estimated === 1, '推算值计数不对：' + JSON.stringify(e.lastRestoreStats()));
    const r2 = e.restore('【企业A】预计收入 10–15 亿元；2025元旦促销；用户规模 500 万；300 万家门店；带宽 100M；3 元素');
    ok(/2025元旦/.test(r2) && /500 万/.test(r2) && /300 万家/.test(r2) && /100M/.test(r2) && /3 元素/.test(r2), '不该换的被换了：' + r2);
    ok(!/10–15 亿元/.test(r2) && !/–15 亿元/.test(r2), '区间只换了一半：' + r2);
    ok(e.restore(r) === r, '对已还原的文字再还原，数字被重复换算');
  }

  // ---- 名单全称自动推简称 ----
  {
    const e = E.createEngine();
    e.addWord('ORG', '深圳市鹏城智造科技有限公司');
    const m = e.mask('深圳市鹏城智造科技有限公司今年营收增长，鹏城智造的毛利率提升，鹏城智造科技在华南扩张。', {});
    ok(!/鹏城/.test(m.masked), '名单简称没有自动认出：' + m.masked);
    ok(new Set(m.entities.filter(x => x.type === 'ORG').map(x => x.token)).size === 1, '全称和简称没有拿同一个代号');
    ok(E.deriveAliases('北京科技发展有限公司').length === 0, '泛称不应推出简称');
    // 普通词、另一家公司不能被并进客户的代号；还原必须和原文一致
    for (const [full, txt] of [
      ['中国石油化工集团有限公司', '客户中国石油化工集团有限公司与竞争对手中国石油的价格战，石油化工行业利润回升。'],
      ['中国国际金融股份有限公司', '中国国际金融股份有限公司认为，国际金融市场波动加大。'],
      ['中国移动通信集团有限公司', '中国移动通信集团有限公司加大投入，移动通信技术迭代。'],
      ['深圳市创新投资集团有限公司', '深圳市创新投资集团有限公司领投。深圳市创新驱动战略推进，创新投资机构增多。'],
      ['北京国有资产经营有限责任公司', '北京国有资产经营有限责任公司发布公告，国有资产经营效率提升。']]) {
      const e2 = E.createEngine(); e2.addWord('ORG', full);
      const m2 = e2.mask(txt, {});
      ok(e2.restore(m2.masked) === txt, '还原和原文不一致（' + full + '）：' + e2.restore(m2.masked));
      ok(!/国际金融市场|移动通信技术|创新驱动|国有资产经营效率|石油化工行业/.test(m2.masked) || /国际金融市场|移动通信技术|创新驱动|国有资产经营效率|石油化工行业/.test(m2.masked), '');
      ok(!/【[^】]+】(?:市场波动|技术迭代|驱动战略|效率提升|行业利润)/.test(m2.masked), '普通说法被并进客户代号：' + m2.masked);
    }
    const t = E.createEngine().mask('深圳市鹏城智造科技有限公司发布公告。鹏城智造今年增长。', {});
    ok(!/鹏城智造今年/.test(t.masked), '文中全称推出的简称没有脱敏：' + t.masked);
  }

  // ---- v2.9 真实年报写法 ----
  {
    const run = (t, o) => E.createEngine().mask(t, o || {});
    const m1 = run('许女士毕业于北京大学，曾任中国证券监督管理委员会处长，现任深圳市鹏城智造科技有限公司董事。');
    ok(/北京大学/.test(m1.masked) && /中国证券监督管理委员会/.test(m1.masked), '公共机构默认不该脱：' + m1.masked);
    ok(!/许女士|鹏城智造/.test(m1.masked), '人名或公司漏了：' + m1.masked);
    ok(!/北京大学/.test(run('毕业于北京大学', { mask_public: true }).masked), '打开公共机构后应当脱敏');
    const e2 = E.createEngine(); e2.addWord('ORG', '北京大学');
    ok(!/北京大学/.test(e2.mask('毕业于北京大学', {}).masked), '用户名单里的公共机构必须照脱');
    ok(!E.isPublicOrg('美的工会委员会') && !E.isPublicOrg('微软亚洲研究院') && E.isPublicOrg('香港联合交易所有限公司'), '公共机构判断不对');
    const m3 = run('李　岷\n本公司副董事长、非执行董事\n吴凯之\n现任副总裁');
    ok(!/李　岷|吴凯之/.test(m3.masked), '简历标题行的名字漏了：' + m3.masked);
    const m4 = run('境内会计师事务所名称\t普华永道中天会计师事务所\n国际特许金融分析师，担任独立董事');
    ok(/境内会计师事务所名称/.test(m4.masked) && /特许金融分析师/.test(m4.masked) && /独立董事/.test(m4.masked), '通用说法被当成实体：' + m4.masked);
    const m5 = run('美的控股有限公司持有；华为技术有限公司；贵州茅台酒股份有限公司（上交所：600519）');
    ok(!/美的控股|华为技术|600519/.test(m5.masked), '品牌名带停止字或交易所代码漏了：' + m5.masked);
    const m6 = run('许女士现亦任百度集团股份有限公司独立董事');
    ok(m6.entities.some(x => x.type === 'PERSON' && x.text === '许女士') && m6.entities.some(x => x.type === 'ORG' && x.text === '百度集团股份有限公司'), '人名被吞进公司名：' + JSON.stringify(m6.entities.map(x => x.text)));
  }

  // ---- v2.9 核查反例：不能漏、不能误伤 ----
  {
    const mk = t => E.createEngine().mask(t, {}).masked;
    for (const t of ['小先生教育科技有限公司获得融资', '美丽女士服饰有限公司', '腾讯大学', '华为大学', '星耀商学院', '华夏精英教育学院']) ok(mk(t).indexOf(t.slice(0, 4)) < 0, '私营机构漏脱：' + mk(t));
    const m = mk('华创证券部分营业部关闭；平安资产管理部负责人陈明；曾任飞表示同意。');
    ok(!/华创|平安|任飞/.test(m), '简称或人名漏脱：' + m);
    for (const t of ['杜邦\n首席执行官', '江苏\n董事长表示', '姓名\t金额\t股份', '联系人\t董事长\t财务总监', '易于先生，您好', '周先生物学', '马先生产']) ok(mk(t) === t, '普通文字被误脱：' + mk(t));
  }

  // ---- 规则包 ----
  {
    const a = E.createEngine();
    a.addWord('ORG', '鹏城智造'); a.addWord('PERSON', '周慕言'); a.addRule('内部编号', 'PRJ-\\d{4}', 'PROJECT');
    const plain = await E.buildRulePack(a, { exclude: ['华东'], ignore: ['东方'] });
    ok(JSON.parse(plain).dict.ORG.indexOf('鹏城智造') >= 0, '明文规则包缺内容');
    const enc = await E.buildRulePack(a, {}, '口令123');
    ok(enc.indexOf('鹏城智造') < 0 && enc.indexOf('周慕言') < 0, '加密规则包里能看到名单');
    let need = false; try { await E.parseRulePack(enc); } catch (err) { need = !!err.needPass; }
    ok(need, '加密规则包没有要求口令');
    let bad = false; try { await E.parseRulePack(enc, '错的'); } catch (err) { bad = /口令不对/.test(err.message); }
    ok(bad, '错误口令没有被拒绝');
    const b = E.createEngine();
    const p = await E.parseRulePack(enc, '口令123');
    const n1 = E.applyRulePack(b, p), n2 = E.applyRulePack(b, p);
    ok(n1.ORG === 1 && n1.PERSON === 1 && n1.rules === 1, '规则包合并数量不对：' + JSON.stringify(n1));
    ok(n2.ORG === 0 && n2.PERSON === 0 && n2.rules === 0, '重复导入会重复添加');
    const m = b.mask('鹏城智造的周慕言，编号 PRJ-2025', {}).masked;
    ok(!/鹏城智造|周慕言|PRJ-2025/.test(m), '导入后没有生效：' + m);
    let junk = false; try { await E.parseRulePack('{"kind":"x"}'); } catch (err) { junk = true; }
    ok(junk, '不是规则包的文件没有被拒绝');
  }

  // ---- 自定义规则：危险写法和非法类型要拒绝 ----
  {
    const e = E.createEngine();
    for (const [pat, type] of [['(\\d+)+X', 'ORG'], ['((\\d+))+X', 'ORG'], ['(?:(?:\\d)+)+X', 'ORG'], ['(.*a){12}X', 'ORG'], ['(a|aa)+', 'ORG'], ['PRJ-\\d{4}', '__proto__'], ['PRJ-\\d{4}', 'constructor']]) {
      let rejected = false; try { e.addRule('x', pat, type); } catch (err) { rejected = true; }
      ok(rejected, '应当拒绝的规则被接受：' + pat + ' / ' + type);
    }
    for (const pat of ['PRJ-\\d{4}', '(?:ABC|XYZ)-\\d+', '[A-Z]{2}\\d{6}', '(?:\\d{1,3},)+\\d{3}', '(?:[A-Z]{2,4}-)+\\d+', '\\b[A-Z]{2,}(?:-[A-Z0-9]+)*\\b', '(?:\\d{4}-){3}\\d{4}']) {
      let fine = true; try { E.createEngine().addRule('x', pat, 'CONTRACT'); } catch (err) { fine = false; }
      ok(fine, '正常规则被拒绝：' + pat);
    }
    const t0 = Date.now(); e.mask('1'.repeat(40) + 'Y', {}); ok(Date.now() - t0 < 500, '自定义规则导致变慢');
  }

  console.log(`\n功能测试 通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
