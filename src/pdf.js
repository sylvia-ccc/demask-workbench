/* 脱敏工作台 · PDF 文字层提取（零依赖）
 *
 * 只读 PDF 自带的文字层，不做 OCR：扫描件会明确报错，不会给出一份错的文本。
 * 支持：对象流、FlateDecode / LZW / ASCII85 / ASCIIHex、ToUnicode、Identity-H、
 *       常见中文预置 CMap（UniGB-UCS2 / UTF16、GBK-EUC 等）、WinAnsi 等单字节编码、
 *       表单 XObject 里的文字、只设了"所有者密码"的加密 PDF（RC4 / AES-128 / AES-256）。
 * 输出：按页、按行还原的纯文本；同一行里距离较远的两段用制表符分开（表格列），
 *       排满一行、没有句末标点的行与下一行拼接（还原段落，避免公司名被断行切开）。
 */
(function (root) {
  'use strict';

  /* ---------------- 基础：字节与字符串 ---------------- */
  function latin1(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return s;
  }
  function bytesOf(str) {
    const u = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255;
    return u;
  }

  /* ---------------- 词法与对象解析 ---------------- */
  const WS = new Uint8Array(256);
  [0, 9, 10, 12, 13, 32].forEach(c => { WS[c] = 1; });
  const DELIM = new Uint8Array(256);
  '()<>[]{}/%'.split('').forEach(c => { DELIM[c.charCodeAt(0)] = 1; });

  function Name(n) { this.name = n; }
  function Ref(n, g) { this.num = n; this.gen = g; }
  function Op(o) { this.op = o; }
  function PStr(s, hex) { this.s = s; this.hex = !!hex; }   // s 是 latin1 字节串

  function Lexer(str, pos) { this.s = str; this.p = pos || 0; this.n = str.length; }
  Lexer.prototype.skipWS = function () {
    const s = this.s; let p = this.p;
    for (; ;) {
      while (p < this.n && WS[s.charCodeAt(p)]) p++;
      if (p < this.n && s.charCodeAt(p) === 37) {          // % 注释
        while (p < this.n && s.charCodeAt(p) !== 10 && s.charCodeAt(p) !== 13) p++;
        continue;
      }
      break;
    }
    this.p = p;
  };
  // 读一个记号：数字 / 名字 / 字符串 / 括号 / 关键字
  Lexer.prototype.token = function () {
    this.skipWS();
    const s = this.s;
    if (this.p >= this.n) return null;
    const c = s[this.p];
    if (c === '[' || c === ']' || c === '{' || c === '}') { this.p++; return { d: c }; }
    if (c === '<') {
      if (s[this.p + 1] === '<') { this.p += 2; return { d: '<<' }; }
      const e = s.indexOf('>', this.p);
      const end = e < 0 ? this.n : e;
      const hex = s.slice(this.p + 1, end).replace(/[^0-9A-Fa-f]/g, '');
      this.p = end + 1;
      let out = '';
      for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt((hex[i] + (hex[i + 1] || '0')), 16));
      return new PStr(out, true);
    }
    if (c === '>') {
      if (s[this.p + 1] === '>') { this.p += 2; return { d: '>>' }; }
      this.p++; return { d: '>' };
    }
    if (c === '(') return this.litString();
    if (c === '/') {
      let p = this.p + 1;
      while (p < this.n && !WS[s.charCodeAt(p)] && !DELIM[s.charCodeAt(p)]) p++;
      const raw = s.slice(this.p + 1, p);
      this.p = p;
      return new Name(raw.indexOf('#') >= 0 ? raw.replace(/#([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))) : raw);
    }
    let p = this.p;
    while (p < this.n && !WS[s.charCodeAt(p)] && !DELIM[s.charCodeAt(p)]) p++;
    if (p === this.p) { this.p++; return { d: c }; }     // 孤立的分隔符，跳过
    const w = s.slice(this.p, p);
    this.p = p;
    const cc = w.charCodeAt(0);
    if ((cc >= 48 && cc <= 57) || cc === 43 || cc === 45 || cc === 46) {
      const v = parseFloat(w);
      if (!isNaN(v)) return v;
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new Op(w);
  };
  Lexer.prototype.litString = function () {
    const s = this.s; let p = this.p + 1, depth = 1, out = '';
    while (p < this.n) {
      const c = s[p];
      if (c === '\\') {
        const d = s[p + 1];
        p += 2;
        if (d === 'n') out += '\n'; else if (d === 'r') out += '\r'; else if (d === 't') out += '\t';
        else if (d === 'b') out += '\b'; else if (d === 'f') out += '\f';
        else if (d === '\r') { if (s[p] === '\n') p++; }
        else if (d === '\n') { /* 续行 */ }
        else if (d >= '0' && d <= '7') {
          let o = d;
          if (s[p] >= '0' && s[p] <= '7') { o += s[p++]; if (s[p] >= '0' && s[p] <= '7') o += s[p++]; }
          out += String.fromCharCode(parseInt(o, 8) & 255);
        } else if (d !== undefined) out += d;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (!depth) { p++; break; } }
      if (out.length < 100000) out += c;      // 超长字符串只保留开头，防止内存暴涨
      p++;
    }
    this.p = p;
    return new PStr(out, false);
  };
  // 解析一个完整对象（字典、数组、引用）
  Lexer.prototype.obj = function (tok) {
    const t = tok === undefined ? this.token() : tok;
    if (t && t.d === '<<') {
      const d = Object.create(null);
      for (; ;) {
        const k = this.token();
        if (k === null || (k && k.d === '>>')) break;
        if (!(k instanceof Name)) continue;
        d[k.name] = this.obj();
      }
      return d;
    }
    if (t && t.d === '[') {
      const a = [];
      for (; ;) {
        const v = this.token();
        if (v === null || (v && v.d === ']')) break;
        a.push(this.obj(v));
      }
      // 把 "n g R" 合成引用
      const out = [];
      for (let i = 0; i < a.length; i++) {
        if (a[i] instanceof Op && a[i].op === 'R' && out.length >= 2 &&
          typeof out[out.length - 1] === 'number' && typeof out[out.length - 2] === 'number') {
          const g = out.pop(), n = out.pop();
          out.push(new Ref(n, g));
        } else out.push(a[i]);
      }
      return out;
    }
    if (typeof t === 'number' && Number.isInteger(t)) {
      // 可能是 "n g R"
      const save = this.p;
      const g = this.token();
      if (typeof g === 'number' && Number.isInteger(g)) {
        const r = this.token();
        if (r instanceof Op && r.op === 'R') return new Ref(t, g);
      }
      this.p = save;
    }
    return t;
  };

  /* ---------------- 解码过滤器 ---------------- */
  // 解压上限：单个流 64MB；防"压缩炸弹"（1MB 文件解成 1GB）把页面内存撑爆
  const MAX_STREAM = 64 * 1024 * 1024;
  async function inflate(u8, raw) {
    if (!u8.length) return new Uint8Array(0);
    const ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
    const writer = ds.writable.getWriter();
    writer.write(u8).catch(() => { });
    writer.close().catch(() => { });
    const reader = ds.readable.getReader();
    const chunks = []; let len = 0;
    try {
      for (; ;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value); len += r.value.length;
        if (len > MAX_STREAM) { reader.cancel().catch(() => { }); throw new LimitError('PDF 里有一个异常巨大的压缩数据（解压后超过 64MB），已停止读取。'); }
      }
    } catch (e) {
      if (e instanceof LimitError) throw e;
      // 数据被截断或校验和不对：保留已经解出来的部分
      if (!len && !raw && u8.length > 2) return inflate(u8.subarray(2), true);
    }
    const out = new Uint8Array(len); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  function LimitError(msg) { const e = new Error(msg); e.limit = true; Object.setPrototypeOf(e, LimitError.prototype); return e; }
  LimitError.prototype = Object.create(Error.prototype);
  function lzw(u8) {
    let out = new Uint8Array(Math.max(1024, u8.length * 4)), n = 0;
    const put = v => {
      if (n >= out.length) {
        if (out.length >= MAX_STREAM) throw new LimitError('PDF 里有一个异常巨大的压缩数据（解压后超过 64MB），已停止读取。');
        const o2 = new Uint8Array(Math.min(MAX_STREAM, out.length * 2)); o2.set(out); out = o2;
      }
      out[n++] = v;
    };
    let dict = [], bits = 9, buf = 0, nb = 0, prev = null;
    const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push(null, null); bits = 9; };
    reset();
    for (let i = 0; i < u8.length; i++) {
      buf = ((buf << 8) | u8[i]) & 0xFFFFFF; nb += 8;
      while (nb >= bits) {
        const code = (buf >>> (nb - bits)) & ((1 << bits) - 1); nb -= bits;
        if (code === 256) { reset(); prev = null; continue; }
        if (code === 257) return out.subarray(0, n);
        let entry;
        if (code < dict.length && dict[code]) entry = dict[code];
        else if (prev) entry = prev.concat(prev[0]);
        else continue;
        for (let k = 0; k < entry.length; k++) put(entry[k]);
        if (prev && dict.length < 4096) dict.push(prev.concat(entry[0]));
        prev = entry;
        if (dict.length + 1 >= (1 << bits) && bits < 12) bits++;
      }
    }
    return out.subarray(0, n);
  }
  function a85(u8) {
    const out = []; let grp = [], i = 0;
    const s = latin1(u8).replace(/^\s*<~/, '');
    for (; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 126) break;                       // ~>
      if (WS[c]) continue;
      if (c === 122 && !grp.length) { out.push(0, 0, 0, 0); continue; }
      grp.push(c - 33);
      if (grp.length === 5) {
        let v = 0; for (const g of grp) v = v * 85 + g;
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); grp = [];
      }
    }
    if (grp.length) {
      const n = grp.length; while (grp.length < 5) grp.push(84);
      let v = 0; for (const g of grp) v = v * 85 + g;
      const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      for (let k = 0; k < n - 1; k++) out.push(b[k]);
    }
    return new Uint8Array(out);
  }
  function ahx(u8) {
    const h = latin1(u8).replace(/>.*$/s, '').replace(/[^0-9A-Fa-f]/g, '');
    const out = new Uint8Array(Math.ceil(h.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt((h[2 * i] + (h[2 * i + 1] || '0')), 16);
    return out;
  }
  function unpredict(u8, parms) {
    const pred = parms && parms.Predictor;
    if (!pred || pred < 10) return u8;
    const colors = parms.Colors || 1, bpc = parms.BitsPerComponent || 8, cols = parms.Columns || 1;
    const bpp = Math.max(1, Math.ceil(colors * bpc / 8));
    const row = Math.ceil(colors * bpc * cols / 8);
    const out = new Uint8Array(Math.floor(u8.length / (row + 1)) * row);
    let prev = new Uint8Array(row), o = 0;
    for (let p = 0; p + row < u8.length + 1 && o < out.length; p += row + 1) {
      const t = u8[p], cur = u8.subarray(p + 1, p + 1 + row), r = new Uint8Array(row);
      for (let i = 0; i < row; i++) {
        const a = i >= bpp ? r[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = cur[i] || 0;
        if (t === 1) v += a; else if (t === 2) v += b; else if (t === 3) v += (a + b) >> 1;
        else if (t === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
        r[i] = v & 255;
      }
      out.set(r, o); o += row; prev = r;
    }
    return out;
  }

  /* ---------------- 加密（只处理用户密码为空的情况） ---------------- */
  // MD5：Web Crypto 不提供，只能自己实现（只用于 PDF 解密，不用于安全用途）
  function md5(u8) {
    const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const len = u8.length, nblk = ((len + 8) >>> 6) + 1, w = new Int32Array(nblk * 16);
    for (let i = 0; i < len; i++) w[i >> 2] |= u8[i] << ((i % 4) * 8);
    w[len >> 2] |= 0x80 << ((len % 4) * 8);
    w[nblk * 16 - 2] = len * 8;
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let blk = 0; blk < nblk; blk++) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const tmp = D; D = C; C = B;
        const x = (A + F + K[i] + w[blk * 16 + g]) | 0, s = S[(i >> 4) * 4 + (i % 4)];
        B = (B + ((x << s) | (x >>> (32 - s)))) | 0; A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((v, j) => { for (let k = 0; k < 4; k++) out[j * 4 + k] = (v >>> (8 * k)) & 255; });
    return out;
  }
  function rc4(key, data) {
    const S = new Uint8Array(256); for (let i = 0; i < 256; i++) S[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
    const out = new Uint8Array(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) {
      i = (i + 1) & 255; j = (j + S[i]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
    }
    return out;
  }
  const PAD = bytesOf('\x28\xBF\x4E\x5E\x4E\x75\x8A\x41\x64\x00\x4E\x56\xFF\xFA\x01\x08\x2E\x2E\x00\xB6\xD0\x68\x3E\x80\x2F\x0C\xA9\xFE\x64\x53\x69\x7A');
  function cat() { let n = 0; for (const a of arguments) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arguments) { o.set(a, p); p += a.length; } return o; }

  async function makeDecryptor(enc, fileId) {
    const V = enc.V || 0, R = enc.R || 2;
    const P = enc.P | 0;
    const O = bytesOf(enc.O ? enc.O.s : '');
    const U = bytesOf(enc.U ? enc.U.s : '');
    let key, aes = false, aes256 = false;
    if (V === 5 || R >= 5) {
      // AES-256：用户密码为空时，文件密钥 = AES-256-CBC 解 /UE（密钥为 SHA-256(用户校验盐)）
      const ue = bytesOf(enc.UE ? enc.UE.s : '');
      const salt = U.subarray(40, 48);
      const vsalt = U.subarray(32, 40);
      const empty = new Uint8Array(0);
      const chk = R === 6 ? await hash2B(empty, vsalt, empty) : new Uint8Array(await crypto.subtle.digest('SHA-256', vsalt));
      if (latin1(chk.subarray(0, 32)) !== latin1(U.subarray(0, 32))) throw new Error('PDF 设置了打开密码，无法读取。请先用 PDF 阅读器输入密码后"另存为"一份不加密的文件。');
      const h = R === 6 ? await hash2B(empty, salt, empty) : new Uint8Array(await crypto.subtle.digest('SHA-256', salt));
      const k = await crypto.subtle.importKey('raw', h, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
      key = await aesCbcNoPad(k, new Uint8Array(16), ue);
      aes = true; aes256 = true;
    } else {
      const len = V === 1 ? 5 : ((enc.Length || 40) >> 3);
      const pb = new Uint8Array([P & 255, (P >> 8) & 255, (P >> 16) & 255, (P >>> 24) & 255]);
      const parts = [PAD, O, pb, bytesOf(fileId || '')];
      if (R >= 4 && enc.EncryptMetadata === false) parts.push(new Uint8Array([255, 255, 255, 255]));
      let h = md5(cat.apply(null, parts));
      if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, len));
      key = h.subarray(0, len);
      const cf = enc.CF && enc.StmF && enc.CF[enc.StmF.name];
      if (V === 4 && cf && cf.CFM && cf.CFM.name === 'AESV2') aes = true;
      if (V === 4 && cf && cf.CFM && cf.CFM.name === 'None') return null;
      // 校验空用户密码是否正确
      const chk = R === 2 ? rc4(key, PAD) : null;
      if (R === 2 && latin1(chk) !== latin1(U.subarray(0, 32))) throw new Error('PDF 设置了打开密码，无法读取。请先用 PDF 阅读器输入密码后"另存为"一份不加密的文件。');
      if (R >= 3) {
        let x = rc4(key, md5(cat(PAD, bytesOf(fileId || ''))));
        for (let i = 1; i <= 19; i++) { const k2 = key.map(b => b ^ i); x = rc4(k2, x); }
        if (latin1(x.subarray(0, 16)) !== latin1(U.subarray(0, 16))) throw new Error('PDF 设置了打开密码，无法读取。请先用 PDF 阅读器输入密码后"另存为"一份不加密的文件。');
      }
    }
    return async function (bytes, num, gen) {
      if (!bytes.length) return bytes;
      let k = key;
      if (!aes256) {
        const ext = [num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255];
        const salt = aes ? [0x73, 0x41, 0x6C, 0x54] : [];
        k = md5(cat(key, new Uint8Array(ext), new Uint8Array(salt))).subarray(0, Math.min(16, key.length + 5));
      }
      if (!aes) return rc4(k, bytes);
      if (bytes.length < 32) return new Uint8Array(0);
      const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-CBC' }, false, ['decrypt']);
      try {
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: bytes.subarray(0, 16) }, ck, bytes.subarray(16)));
      } catch (e) { return new Uint8Array(0); }
    };
  }
  // Web Crypto 的 AES-CBC 只认带 PKCS#7 填充的数据：在末尾补一个"能解成填充"的密文块
  async function aesCbcNoPad(key, iv, data) {
    if (!data.length || data.length % 16) throw new Error('加密信息不完整');
    const last = data.subarray(data.length - 16);
    const pad = new Uint8Array(16).fill(16);
    const extra = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last }, key, pad)).subarray(0, 16);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, key, cat(data, extra)));
  }
  // PDF 2.0（R6）的密码散列，算法 2.B
  async function hash2B(pwd, salt, udata) {
    let K = new Uint8Array(await crypto.subtle.digest('SHA-256', cat(pwd, salt, udata)));
    for (let round = 0; ; round++) {
      const one = cat(pwd, K, udata);
      const K1 = new Uint8Array(one.length * 64);
      for (let i = 0; i < 64; i++) K1.set(one, i * one.length);
      const ak = await crypto.subtle.importKey('raw', K.subarray(0, 16), { name: 'AES-CBC' }, false, ['encrypt']);
      const E = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: K.subarray(16, 32) }, ak, K1)).subarray(0, K1.length);
      let sum = 0; for (let i = 0; i < 16; i++) sum += E[i];
      const alg = ['SHA-256', 'SHA-384', 'SHA-512'][sum % 3];
      K = new Uint8Array(await crypto.subtle.digest(alg, E));
      if (round >= 63 && E[E.length - 1] <= round - 31) break;
      if (round > 2000) break;
    }
    return K.subarray(0, 32);
  }

  /* ---------------- 文档：对象表 ---------------- */
  async function openDoc(u8) {
    const s = latin1(u8);
    if (s.slice(0, 1024).indexOf('%PDF') < 0) throw new Error('不是有效的 PDF 文件');
    const objs = new Map();      // num -> {off, gen} | {val}
    const re = /(\d{1,10})\s{1,8}(\d{1,5})\s{1,8}obj\b/g;
    let m;
    const streams = [];          // 对象流
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
      const num = +m[1], gen = +m[2];
      const lx = new Lexer(s, re.lastIndex);
      let val;
      try { val = lx.obj(); } catch (e) { if (e && e.limit) throw e; continue; }
      const ent = { num: num, gen: gen, val: val, stream: null };
      lx.skipWS();
      if (val && typeof val === 'object' && !(val instanceof Array) && s.startsWith('stream', lx.p)) {
        let p = lx.p + 6;
        if (s[p] === '\r') p++;
        if (s[p] === '\n') p++;
        let len = typeof val.Length === 'number' ? val.Length : -1;
        let end;
        if (len >= 0 && /^\s*endstream/.test(s.substr(p + len, 20))) end = p + len;
        else {
          end = s.indexOf('endstream', p);
          if (end < 0) end = s.length;
          let e2 = end;
          if (s[e2 - 1] === '\n') e2--;
          if (s[e2 - 1] === '\r') e2--;
          end = e2;
        }
        ent.stream = { start: p, end: end };
        re.lastIndex = end;
        if (val.Type instanceof Name && val.Type.name === 'ObjStm') streams.push(ent);
      } else {
        re.lastIndex = Math.max(re.lastIndex, lx.p);
      }
      objs.set(num, ent);
    }

    const doc = { s: s, u8: u8, objs: objs, decrypt: null, cache: new Map() };

    // 找 trailer：经典 trailer 字典，或交叉引用流的字典
    let trailer = null;
    const ti = s.lastIndexOf('trailer');
    if (ti >= 0) { try { trailer = new Lexer(s, ti + 7).obj(); } catch (e) { trailer = null; } }
    if (!trailer || !trailer.Root) {
      for (const ent of objs.values()) {
        const v = ent.val;
        if (v && v.Type instanceof Name && v.Type.name === 'XRef' && v.Root) trailer = v;
      }
    }
    doc.trailer = trailer || {};

    if (doc.trailer.Encrypt) {
      const enc = resolveSync(doc, doc.trailer.Encrypt);
      const ids = doc.trailer.ID;
      const id0 = ids && ids[0] instanceof PStr ? ids[0].s : '';
      const filt = enc && enc.Filter instanceof Name ? enc.Filter.name : '';
      if (filt !== 'Standard') throw new Error('PDF 使用了证书或第三方加密，无法读取。');
      doc.decrypt = await makeDecryptor(enc, id0);
      doc.encryptRef = doc.trailer.Encrypt instanceof Ref ? doc.trailer.Encrypt.num : -1;
    }

    // 展开对象流（流里的对象不单独加密）
    for (const ent of streams) {
      let data;
      try { data = await streamBytes(doc, ent); } catch (e) { if (e && e.limit) throw e; continue; }
      const str = latin1(data);
      const n = ent.val.N || 0, first = ent.val.First || 0;
      const lx = new Lexer(str, 0);
      const pairs = [];
      for (let i = 0; i < n; i++) { const a = lx.token(), b = lx.token(); if (typeof a !== 'number' || typeof b !== 'number') break; pairs.push([a, b]); }
      for (const [num, off] of pairs) {
        const ex = objs.get(num);
        if (ex && !ex.inStm) continue;   // 直接写在文件里的对象优先（通常是增量更新）
        let v;
        try { v = new Lexer(str, first + off).obj(); } catch (e) { if (e && e.limit) throw e; continue; }
        objs.set(num, { num: num, gen: 0, val: v, stream: null, inStm: true });
      }
    }
    return doc;
  }

  function resolveSync(doc, v) {
    let guard = 0;
    while (v instanceof Ref && guard++ < 20) {
      const ent = doc.objs.get(v.num);
      if (!ent) return null;
      v = ent.val;
    }
    return v;
  }

  async function streamBytes(doc, ent) {
    if (!ent || !ent.stream) return new Uint8Array(0);
    if (ent.decoded) return ent.decoded;
    let data = doc.u8.subarray(ent.stream.start, ent.stream.end);
    if (doc.decrypt && !ent.inStm && ent.num !== doc.encryptRef) {
      const isXref = ent.val.Type instanceof Name && ent.val.Type.name === 'XRef';
      if (!isXref) data = await doc.decrypt(data, ent.num, ent.gen);
    }
    let filters = resolveSync(doc, ent.val.Filter);
    let parms = resolveSync(doc, ent.val.DecodeParms);
    if (filters instanceof Name) { filters = [filters]; parms = [parms]; }
    if (!(filters instanceof Array)) filters = [];
    if (!(parms instanceof Array)) parms = [parms];
    for (let i = 0; i < filters.length; i++) {
      const f = resolveSync(doc, filters[i]);
      const fname = f instanceof Name ? f.name : '';
      const pm = resolveSync(doc, parms[i]);
      if (fname === 'FlateDecode' || fname === 'Fl') data = unpredict(await inflate(data), pm);
      else if (fname === 'LZWDecode' || fname === 'LZW') data = unpredict(lzw(data), pm);
      else if (fname === 'ASCII85Decode' || fname === 'A85') data = a85(data);
      else if (fname === 'ASCIIHexDecode' || fname === 'AHx') data = ahx(data);
      else if (fname === 'Crypt') { /* 已处理 */ }
      else return new Uint8Array(0);     // 图片类过滤器：不是文字，跳过
    }
    doc.decodedTotal = (doc.decodedTotal || 0) + data.length;
    if (doc.decodedTotal > 400 * 1024 * 1024) throw new LimitError('PDF 解压后的数据超过 400MB，已停止读取（文件可能被故意构造过）。');
    if (data.length < 4e6) ent.decoded = data;
    return data;
  }
  async function refStreamBytes(doc, ref) {
    if (ref instanceof Ref) return streamBytes(doc, doc.objs.get(ref.num));
    return new Uint8Array(0);
  }

  /* ---------------- 字体与编码 ---------------- */
  const WIN = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030,
    0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
    0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178
  };
  const GLYPH = {
    space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'",
    parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
    backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|',
    braceright: '}', asciitilde: '~', bullet: '•', endash: '–', emdash: '—', quoteleft: '‘', quoteright: '’',
    quotedblleft: '“', quotedblright: '”', ellipsis: '…', minus: '−', multiply: '×', divide: '÷', degree: '°',
    copyright: '©', registered: '®', trademark: '™', section: '§', paragraph: '¶', periodcentered: '·', yen: '¥',
    sterling: '£', Euro: '€', cent: '¢', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', nbspace: ' ', uni00A0: ' '
  };
  function glyphToUni(g) {
    if (GLYPH[g] !== undefined) return GLYPH[g];
    if (/^[A-Za-z]$/.test(g)) return g;
    let m = /^uni([0-9A-Fa-f]{4,})$/.exec(g);
    if (m) { let o = ''; for (let i = 0; i + 4 <= m[1].length; i += 4) o += String.fromCharCode(parseInt(m[1].substr(i, 4), 16)); return o; }
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(g);
    if (m) return String.fromCodePoint(parseInt(m[1], 16));
    m = /^([A-Za-z]+)\.\w+$/.exec(g);           // a.sc、one.oldstyle
    if (m) return glyphToUni(m[1]);
    return null;
  }
  function utf16be(str) {
    let o = '';
    for (let i = 0; i + 1 < str.length; i += 2) o += String.fromCharCode((str.charCodeAt(i) << 8) | str.charCodeAt(i + 1));
    return o;
  }

  // 解析 CMap（ToUnicode 或嵌入的编码 CMap）
  function parseCMap(str) {
    const cm = { space: [], map: new Map(), ranges: [], cid: new Map(), cidRanges: [] };
    const lx = new Lexer(str, 0);
    const toks = [];
    for (; ;) { const t = lx.token(); if (t === null) break; toks.push(t); }
    const hexNum = t => { let v = 0; for (let i = 0; i < t.s.length; i++) v = v * 256 + t.s.charCodeAt(i); return v; };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!(t instanceof Op)) continue;
      if (t.op === 'begincodespacerange') {
        for (i++; i + 1 < toks.length && !(toks[i] instanceof Op); i += 2) {
          const a = toks[i], b = toks[i + 1];
          if (a instanceof PStr && b instanceof PStr) cm.space.push({ len: a.s.length, lo: a.s, hi: b.s });
        }
      } else if (t.op === 'beginbfchar') {
        for (i++; i + 1 < toks.length && !(toks[i] instanceof Op); i += 2) {
          const a = toks[i], b = toks[i + 1];
          if (a instanceof PStr && b instanceof PStr) cm.map.set(a.s.length + ':' + hexNum(a), utf16be(b.s));
          else if (a instanceof PStr && b instanceof Name) { const u = glyphToUni(b.name); if (u) cm.map.set(a.s.length + ':' + hexNum(a), u); }
        }
      } else if (t.op === 'beginbfrange') {
        for (i++; i + 2 < toks.length && !(toks[i] instanceof Op);) {
          const a = toks[i], b = toks[i + 1];
          let d = toks[i + 2];
          if (d && d.d === '[') {           // 数组形式
            const arr = []; let k = i + 3;
            while (k < toks.length && !(toks[k] && toks[k].d === ']')) { arr.push(toks[k]); k++; }
            const lo = hexNum(a);
            arr.forEach((x, j) => { if (x instanceof PStr) cm.map.set(a.s.length + ':' + (lo + j), utf16be(x.s)); });
            i = k + 1; continue;
          }
          if (a instanceof PStr && b instanceof PStr && d instanceof PStr) {
            cm.ranges.push({ len: a.s.length, lo: hexNum(a), hi: hexNum(b), dst: utf16be(d.s) });
          }
          i += 3;
        }
        i--;
      } else if (t.op === 'begincidchar') {
        for (i++; i + 1 < toks.length && !(toks[i] instanceof Op); i += 2) {
          const a = toks[i], b = toks[i + 1];
          if (a instanceof PStr && typeof b === 'number') cm.cid.set(a.s.length + ':' + hexNum(a), b);
        }
        i--;
      } else if (t.op === 'begincidrange') {
        for (i++; i + 2 < toks.length && !(toks[i] instanceof Op); i += 3) {
          const a = toks[i], b = toks[i + 1], c = toks[i + 2];
          if (a instanceof PStr && b instanceof PStr && typeof c === 'number') cm.cidRanges.push({ len: a.s.length, lo: hexNum(a), hi: hexNum(b), cid: c });
        }
        i--;
      }
    }
    cm.ranges.sort((x, y) => x.lo - y.lo);
    return cm;
  }
  // 区间表按起点排序后二分查找（区间可能有几万个）
  function rangeFind(arr, code) {
    if (!arr.sorted) { arr.sort((x, y) => x[0] - y[0]); arr.sorted = true; }
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, r = arr[mid];
      if (code < r[0]) hi = mid - 1; else if (code > r[1]) lo = mid + 1; else return r[2];
    }
    return undefined;
  }
  function cmapLookup(cm, len, code) {
    const k = cm.map.get(len + ':' + code);
    if (k !== undefined) return k;
    if (!cm.byLen) {
      cm.byLen = {};
      for (const r of cm.ranges) (cm.byLen[r.len] = cm.byLen[r.len] || []).push([r.lo, r.hi, r]);
    }
    const arr = cm.byLen[len];
    const hitR = arr ? rangeFind(arr, code) : undefined;
    for (const r of (hitR ? [hitR] : [])) {
      if (r.len === len && code >= r.lo && code <= r.hi) {
        const d = r.dst;
        if (!d) return '';
        const last = d.charCodeAt(d.length - 1) + (code - r.lo);
        return d.slice(0, -1) + String.fromCharCode(last & 0xFFFF);
      }
    }
    return undefined;
  }
  // 按 codespace 切分字节串
  function splitCodes(bytes, space, defLen) {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      let len = 0;
      if (space && space.length) {
        for (const sp of space) {
          if (i + sp.len > bytes.length) continue;
          let ok = true;
          for (let k = 0; k < sp.len; k++) {
            const c = bytes.charCodeAt(i + k);
            if (c < sp.lo.charCodeAt(k) || c > sp.hi.charCodeAt(k)) { ok = false; break; }
          }
          if (ok && (!len || sp.len < len)) len = sp.len;
        }
      }
      if (!len) len = Math.min(defLen, bytes.length - i);
      let code = 0;
      for (let k = 0; k < len; k++) code = code * 256 + bytes.charCodeAt(i + k);
      out.push({ code: code, len: len });
      i += len;
    }
    return out;
  }
  let gbkDec = null;
  function gbk(bytesStr) {
    try { gbkDec = gbkDec || new TextDecoder('gbk'); return gbkDec.decode(bytesOf(bytesStr)); } catch (e) { return ''; }
  }
  // 没有 ToUnicode 的 Adobe-GB1 字体（年报里常见于标点）：CID 0–939 是符号区，直接查表；
  // 940–7702 是 GB2312 一二级汉字，按 GB2312 区位顺序推算（D7 区只有 89 个字）
  const GB1_LO = '\u0000 !"#$%&\u0027()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\u005c]^_`abcdefghijklmnopqrstuvwxyz{|}~\u3000、。·ˉˇ¨〃々—～‖…‘’“”〔〕〈〉《》「」『』〖〗【】±×÷∶∧∨∑∏∪∩∈∷√⊥∥∠⌒⊙∫∮≡≌≈∽∝≠≮≯≤≥∞∵∴♂♀°′″℃＄¤￠￡‰§№☆★○●◎◇◆□■△▲※→←↑↓〓⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇①②③④⑤⑥⑦⑧⑨⑩㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ！＂＃￥％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝￣ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω︐︒︑\ue790\ue791\ue792\ue793︵︶︹︺︿﹀︽︾﹁﹂﹃﹄\ue794\ue795︻︼︷︸︱⁝︳︴АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêɑḿńňǹɡㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ\u0000─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋！＂＃￥％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝￣āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüê\u0000ḿ\u0000\u0000ǹ\u0000';
  function gb1Cid(cid) {
    if (cid < 940) { const c = GB1_LO[cid] || ''; return c === '\u0000' ? '' : c; }
    if (cid > 7702) return '';
    let k = cid - 940, row, cell;
    if (k < 3666) { row = 0xB0 + (k / 94 | 0); cell = 0xA1 + k % 94; }
    else if (k < 3755) { row = 0xD7; cell = 0xA1 + (k - 3666); }
    else { k -= 3755; row = 0xD8 + (k / 94 | 0); cell = 0xA1 + k % 94; }
    return gbk(String.fromCharCode(row, cell));
  }
  const GBK_SPACE = [{ len: 1, lo: '\x00', hi: '\x80' }, { len: 2, lo: '\x81\x40', hi: '\xfe\xfe' }];

  async function loadFont(doc, ref) {
    const key = ref instanceof Ref ? 'f' + ref.num : null;
    if (key && doc.cache.has(key)) return doc.cache.get(key);
    const fd = resolveSync(doc, ref) || {};
    const sub = fd.Subtype instanceof Name ? fd.Subtype.name : '';
    const font = { type0: sub === 'Type0', space: null, defLen: 1, toU: null, enc: null, widths: new Map(), wRanges: [], dw: 1000, mode: 'simple', vertical: false };
    if (fd.ToUnicode instanceof Ref) {
      try { font.toU = parseCMap(latin1(await refStreamBytes(doc, fd.ToUnicode))); } catch (e) { if (e && e.limit) throw e; font.toU = null; }
    }
    if (font.type0) {
      font.defLen = 2;
      const encv = resolveSync(doc, fd.Encoding);
      const ename = encv instanceof Name ? encv.name : '';
      font.vertical = /-V$/.test(ename);
      if (/^Identity-[HV]$/.test(ename)) font.space = [{ len: 2, lo: '\x00\x00', hi: '\xff\xff' }];
      else if (/^Uni\w+-UTF16-[HV]$/.test(ename) || /^Uni\w+-UCS2-[HV]$/.test(ename)) { font.space = [{ len: 2, lo: '\x00\x00', hi: '\xff\xff' }]; font.mode = 'utf16'; }
      else if (/^(GBK-EUC|GBK2K|GB-EUC|GBpc-EUC|GBKp-EUC)-[HV]$/.test(ename)) { font.space = GBK_SPACE; font.mode = 'gbk'; }
      else if (/^(B5pc|ETen-B5|HKscs-B5|ETenms-B5)-[HV]$/.test(ename)) { font.space = GBK_SPACE; font.mode = 'big5'; }
      else if (encv instanceof Ref) {
        try { const ecm = parseCMap(latin1(await refStreamBytes(doc, encv))); if (ecm.space.length) font.space = ecm.space; } catch (e) { if (e && e.limit) throw e; /* 忽略 */ }
      }
      if (font.toU && font.toU.space.length && !(font.mode === 'gbk' || font.mode === 'big5')) {
        // ToUnicode 的 codespace 往往比编码更准确（比如单字节 + 双字节混排）
        if (!/^Identity/.test(ename)) font.space = font.space || font.toU.space;
      }
      const desc = resolveSync(doc, fd.DescendantFonts);
      const d0 = resolveSync(doc, desc instanceof Array ? desc[0] : null) || {};
      if (typeof d0.DW === 'number') font.dw = d0.DW;
      if (!font.toU && /^Identity-[HV]$/.test(ename) && d0.Subtype instanceof Name && d0.Subtype.name === 'CIDFontType0') {
        const si = resolveSync(doc, d0.CIDSystemInfo) || {};
        const ord = resolveSync(doc, si.Ordering);
        const os = ord instanceof PStr ? ord.s : (ord && ord.name) || '';
        if (os === 'GB1') font.mode = 'gb1';
      }
      const W = resolveSync(doc, d0.W);
      if (W instanceof Array) {
        for (let i = 0; i < W.length;) {
          const a = resolveSync(doc, W[i]), b = resolveSync(doc, W[i + 1]);
          if (typeof a === 'number' && b instanceof Array) {
            if (font.widths.size < 200000) b.forEach((w, j) => font.widths.set(a + j, +resolveSync(doc, w) || 0));
            i += 2;
          } else if (typeof a === 'number' && typeof b === 'number') {
            const w = +resolveSync(doc, W[i + 2]) || 0;
            // 区间不展开，存成区间表（恶意文件可以写几万个超大区间）
            if (b >= a && font.wRanges.length < 100000) font.wRanges.push([a, b, w]);
            i += 3;
          } else i++;
        }
      }
    } else {
      // 单字节字体
      const encv = resolveSync(doc, fd.Encoding);
      const table = new Array(256);
      let base = 'Standard';
      if (encv instanceof Name) base = encv.name;
      else if (encv && encv.BaseEncoding instanceof Name) base = encv.BaseEncoding.name;
      for (let c = 0; c < 256; c++) {
        let u = c;
        if (base === 'WinAnsiEncoding' && WIN[c]) u = WIN[c];
        else if (base !== 'WinAnsiEncoding' && base !== 'MacRomanEncoding' && c === 0x27) u = 0x2019;
        else if (base !== 'WinAnsiEncoding' && base !== 'MacRomanEncoding' && c === 0x60) u = 0x2018;
        table[c] = (c < 32 && c !== 9) ? '' : String.fromCharCode(u);
      }
      if (encv && encv.Differences instanceof Array) {
        let c = 0;
        for (const d of encv.Differences) {
          const v = resolveSync(doc, d);
          if (typeof v === 'number') c = v;
          else if (v instanceof Name) { const u = glyphToUni(v.name); if (u !== null && c < 256) table[c] = u; c++; }
        }
      }
      font.enc = table;
      const fc = typeof fd.FirstChar === 'number' ? fd.FirstChar : 0;
      const ws = resolveSync(doc, fd.Widths);
      if (ws instanceof Array) ws.forEach((w, j) => font.widths.set(fc + j, +resolveSync(doc, w) || 0));
      const desc = resolveSync(doc, fd.FontDescriptor);
      font.dw = desc && typeof desc.MissingWidth === 'number' && desc.MissingWidth ? desc.MissingWidth : 500;
      if (sub === 'Type3') font.type3 = resolveSync(doc, fd.FontMatrix) || [0.001, 0, 0, 0.001, 0, 0];
    }
    if (key) doc.cache.set(key, font);
    return font;
  }
  // 把一段字节串解成 [{u: 字符, w: 宽度(千分之一 em), sp: 是否单字节空格}]
  function decodeShow(font, bytes) {
    const out = [];
    const codes = font.type0 ? splitCodes(bytes, font.space || (font.toU && font.toU.space), font.defLen)
      : Array.from(bytes, ch => ({ code: ch.charCodeAt(0), len: 1 }));
    for (const c of codes) {
      let u;
      if (font.toU) u = cmapLookup(font.toU, c.len, c.code);
      if (u === undefined) {
        if (!font.type0) u = font.enc[c.code];
        else if (font.mode === 'utf16') u = String.fromCharCode(c.code);
        else if (font.mode === 'gb1') u = gb1Cid(c.code);
        else if (font.mode === 'gbk') u = gbk(c.len === 2 ? String.fromCharCode(c.code >> 8, c.code & 255) : String.fromCharCode(c.code));
        else if (font.mode === 'big5') { try { u = new TextDecoder('big5').decode(new Uint8Array(c.len === 2 ? [c.code >> 8, c.code & 255] : [c.code])); } catch (e) { u = ''; } }
        else u = '';                             // Identity-H 又没有 ToUnicode：无法得知是什么字
      }
      if (u === undefined) u = '';
      u = u.replace(/[\u0000-\u0008\u000b-\u001f�]/g, '');
      let w = font.widths.get(c.code);
      if (w === undefined && font.wRanges.length) w = rangeFind(font.wRanges, c.code);
      if (w === undefined) w = font.dw;
      if (font.type3) w = w * font.type3[0] * 1000;
      out.push({ u: u, w: w, sp: c.len === 1 && c.code === 32 });
    }
    return out;
  }

  /* ---------------- 内容流解释 ---------------- */
  function mul(a, b) {
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  }

  async function runContent(doc, bytes, resources, ctm0, runs, depth, stats) {
    if (depth > 6) return;
    const res = resolveSync(doc, resources) || {};
    const fontsDict = resolveSync(doc, res.Font) || {};
    const xobjs = resolveSync(doc, res.XObject) || {};
    const s = latin1(bytes);
    const lx = new Lexer(s, 0);
    const stack = [];
    const gs = [];
    let ctm = ctm0.slice();
    let font = null, fs = 0, Tc = 0, Tw = 0, Th = 1, TL = 0, Trise = 0;
    let Tm = [1, 0, 0, 1, 0, 0], Tlm = [1, 0, 0, 1, 0, 0];
    const fontCache = Object.create(null);

    function show(str) {
      if (!font) return;
      if (str.length > 20000) { str = str.slice(0, 20000); stats.clipped = true; }   // 正常排版一次画不了这么多字
      if (stats.chars > MAX_CHARS) return;
      const glyphs = decodeShow(font, str);
      let text = '';
      const trm0 = mul([fs * Th, 0, 0, fs, 0, Trise], mul(Tm, ctm));
      const x0 = trm0[4], y0 = trm0[5];
      const size = Math.hypot(trm0[2], trm0[3]) || Math.abs(fs) || 1;
      for (const g of glyphs) {
        text += g.u;
        const tx = ((g.w / 1000) * fs + Tc + (g.sp ? Tw : 0)) * Th;
        Tm = mul([1, 0, 0, 1, tx, 0], Tm);
      }
      const trm1 = mul([fs * Th, 0, 0, fs, 0, Trise], mul(Tm, ctm));
      // 文字方向：横排、整页旋转 90/180/270 度的都保留（换到文字自己的坐标系里排版）；斜着的水印丢掉
      const ang = Math.atan2(trm0[1], trm0[0]);
      const q = Math.round(ang / (Math.PI / 2));
      if (Math.abs(ang - q * Math.PI / 2) > 0.1) { stats.rotated += text.length; return; }
      const k = ((q % 4) + 4) % 4;
      const rot = (x, y) => k === 0 ? [x, y] : k === 1 ? [y, -x] : k === 2 ? [-x, -y] : [-y, x];
      const p0 = rot(x0, y0), p1 = rot(trm1[4], trm1[5]);
      if (text) runs.push({ s: text, x0: p0[0], x1: p1[0], y: p0[1], h: size, k: k });
      stats.chars += text.replace(/\s/g, '').length;
    }

    for (; ;) {
      const t = lx.token();
      if (t === null) break;
      if (!(t instanceof Op)) {
        if (t && t.d === '[') { stack.push(lx.obj(t)); continue; }
        if (t && t.d === '<<') { stack.push(lx.obj(t)); continue; }
        stack.push(t);
        continue;
      }
      const op = t.op;
      const a = stack;
      switch (op) {
        case 'q': gs.push({ ctm: ctm.slice(), font, fs, Tc, Tw, Th, TL, Trise }); break;
        case 'Q': { const g = gs.pop(); if (g) { ctm = g.ctm; font = g.font; fs = g.fs; Tc = g.Tc; Tw = g.Tw; Th = g.Th; TL = g.TL; Trise = g.Trise; } break; }
        case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6).map(Number), ctm); break;
        case 'BT': Tm = [1, 0, 0, 1, 0, 0]; Tlm = Tm.slice(); break;
        case 'ET': break;
        case 'Tf': {
          const nm = a[a.length - 2], sz = a[a.length - 1];
          fs = typeof sz === 'number' ? sz : fs;
          if (nm instanceof Name) {
            if (!fontCache[nm.name]) fontCache[nm.name] = await loadFont(doc, fontsDict[nm.name]);
            font = fontCache[nm.name];
          }
          break;
        }
        case 'Tc': Tc = +a[a.length - 1] || 0; break;
        case 'Tw': Tw = +a[a.length - 1] || 0; break;
        case 'Tz': Th = (+a[a.length - 1] || 100) / 100; break;
        case 'TL': TL = +a[a.length - 1] || 0; break;
        case 'Ts': Trise = +a[a.length - 1] || 0; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, +a[a.length - 2] || 0, +a[a.length - 1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'TD': TL = -(+a[a.length - 1] || 0); Tlm = mul([1, 0, 0, 1, +a[a.length - 2] || 0, +a[a.length - 1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'Tm': if (a.length >= 6) { Tlm = a.slice(-6).map(Number); Tm = Tlm.slice(); } break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); break;
        case 'Tj': { const v = a[a.length - 1]; if (v instanceof PStr) show(v.s); break; }
        case "'": { Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); const v = a[a.length - 1]; if (v instanceof PStr) show(v.s); break; }
        case '"': { Tw = +a[a.length - 3] || 0; Tc = +a[a.length - 2] || 0; Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); const v = a[a.length - 1]; if (v instanceof PStr) show(v.s); break; }
        case 'TJ': {
          const arr = a[a.length - 1];
          if (arr instanceof Array) {
            for (const x of arr) {
              if (x instanceof PStr) show(x.s);
              else if (typeof x === 'number') Tm = mul([1, 0, 0, 1, -x / 1000 * fs * Th, 0], Tm);
            }
          }
          break;
        }
        case 'Do': {
          const nm = a[a.length - 1];
          if (!(nm instanceof Name)) break;
          const ref = xobjs[nm.name];
          const ent = ref instanceof Ref ? doc.objs.get(ref.num) : null;
          if (!ent || !ent.val) break;
          const st = ent.val.Subtype instanceof Name ? ent.val.Subtype.name : '';
          if (st === 'Image') { stats.images++; break; }
          if (st !== 'Form') break;
          // 正在画的表单里又调用自己：循环，跳过；每页表单调用总次数也有上限
          if (stats.formActive.has(ref.num) || ++stats.formCalls > 3000) break;
          stats.formActive.add(ref.num);
          const mtx = resolveSync(doc, ent.val.Matrix);
          const m2 = mtx instanceof Array && mtx.length === 6 ? mtx.map(Number) : [1, 0, 0, 1, 0, 0];
          const data = await streamBytes(doc, ent);
          try { await runContent(doc, data, ent.val.Resources || resources, mul(m2, ctm), runs, depth + 1, stats); }
          finally { stats.formActive.delete(ref.num); }
          break;
        }
        case 'BI': {                     // 内嵌图片：跳到 EI
          const e = s.indexOf('EI', lx.p);
          let p = e;
          while (p >= 0 && !(WS[s.charCodeAt(p - 1)] && (p + 2 >= s.length || WS[s.charCodeAt(p + 2)]))) p = s.indexOf('EI', p + 2);
          lx.p = p < 0 ? s.length : p + 2;
          stats.images++;
          break;
        }
        default: break;
      }
      stack.length = 0;
    }
  }

  /* ---------------- 版面：把文字片段拼回行和段落 ---------------- */
  const CJK = /[　-〿㐀-鿿＀-￯]/;
  const END_SENT = /[。！？；：…”」』\]】.!?;:]$/;            // 句末标点（不含右括号："（集团）"后面往往还有字）
  const NUMBERED = /^(\d+[、.．)]|[（(]?[一二三四五六七八九十]+[、)）]|第[一二三四五六七八九十\d]+[章节条])/;
  const ORG_END = /(?:公司|中心|银行|集团|事务所|研究院|研究所|大学|学院|医院|厂|局|委员会|协会|基金|（有限合伙）|\(有限合伙\)|Limited|Ltd\.?|LLC|L\.P\.|LP|Inc\.?|Corp\.?|Corporation|Company|Co\.|GmbH|AG|S\.A\.|B\.V\.|Pte\.? ?Ltd\.?|PLC|plc|N\.V\.|KK|K\.K\.)$/;
  const INCOMPLETE = /(?:有限|股份|责任|[（(、和及与的之])$/;   // 明显没写完
  const SUFFIX_START = /^(?:（集团）|\(集团\)|有限责任公司|股份有限公司|有限公司|责任公司|公司|集团|（有限合伙）|有限合伙|合伙企业)/;
  const NUMERIC = /^[\d,，.．%％\-—–+()（）\s]+$/;

  // 按出现顺序分行，行内再按间距分成单元格
  function buildLines(rs) {
    const lines = [];
    let cur = null;
    for (const r of rs) {
      if (!r.s) continue;
      const h = cur ? Math.max(r.h, cur.h) : r.h;
      if (cur && Math.abs(r.y - cur.y) <= h * 0.5 && r.x0 >= cur.x1 - h * 1.2) {
        const gap = r.x0 - cur.x1;
        const cell = cur.cells[cur.cells.length - 1];
        const prevCh = cell.text[cell.text.length - 1] || '', nextCh = r.s[0];
        const numPair = /[\d%）)]/.test(prevCh) && /[\d(（\-]/.test(nextCh);
        if (gap > h * 1.6 || (numPair && gap > h * 0.6)) {
          cur.cells.push({ text: r.s, x0: r.x0, x1: r.x1 });
        } else {
          if (gap > h * 0.18 && !(CJK.test(prevCh) && CJK.test(nextCh)) && prevCh !== ' ' && nextCh !== ' ') cell.text += ' ';
          cell.text += r.s;
          cell.x1 = Math.max(cell.x1, r.x1);
        }
        cur.x1 = Math.max(cur.x1, r.x1);
        cur.h = h;
      } else {
        cur = { cells: [{ text: r.s, x0: r.x0, x1: r.x1 }], x0: r.x0, x1: r.x1, y: r.y, h: r.h };
        lines.push(cur);
      }
    }
    const out = [];
    for (const l of lines) {
      l.cells = l.cells.map(c => { c.text = c.text.replace(/[  ]{2,}/g, ' ').trim(); return c; }).filter(c => c.text);
      if (!l.cells.length) continue;
      for (const c of l.cells) { c.px1 = c.x1; c.plen = c.text.length; }
      l.py = l.y; l.px0 = l.x0; l.px1 = l.x1;
      out.push(l);
    }
    return out;
  }

  function layoutGroup(rs) {
    const ls = buildLines(rs);
    if (!ls.length) return '';
    const single = ls.filter(l => l.cells.length === 1 && l.cells[0].text.length > 8);
    // 正文右边界：长行的右端最集中的位置（排满的行都停在这里）
    const rights = single.map(l => l.x1).sort((a, b) => b - a);
    let right = rights.length ? rights[0] : Math.max.apply(null, ls.map(l => l.x1)), best = 0;
    const hh = ls[0].h;
    for (const x of rights) {
      let c = 0; for (const y of rights) if (Math.abs(x - y) <= hh) c++;
      if (c > best) { best = c; right = x; }
    }
    const lefts = single.map(l => l.x0).sort((a, b) => a - b);
    const left = lefts.length ? lefts[Math.floor(lefts.length * 0.1)] : Math.min.apply(null, ls.map(l => l.x0));
    // 每一列（按左边界分组）最靠右的位置：判断单元格里的字是不是排满了这一列
    const colMax = new Map();
    for (const l of ls) for (const c of l.cells) {
      const key = Math.round(c.x0 / 3);
      colMax.set(key, Math.max(colMax.get(key) || -Infinity, c.x1));
    }
    const colRight = x0 => { const k = Math.round(x0 / 3); return Math.max(colMax.get(k - 1) || -Infinity, colMax.get(k) || -Infinity, colMax.get(k + 1) || -Infinity); };
    const glue = (a, b) => (/[A-Za-z0-9,]/.test(a[a.length - 1] || '') && /^[A-Za-z0-9]/.test(b)) ? ' ' : '';

    const res = [];
    for (const n of ls) {
      const l = res[res.length - 1];
      if (!l) { res.push(n); continue; }
      const h = l.h;
      const below = n.y < l.py && (l.py - n.y) < h * 2.2 && Math.abs(n.h - h) < h * 0.25;
      const ntext = n.cells[0].text;
      if (below && l.cells.length === 1 && n.cells.length === 1) {
        const lc = l.cells[0];
        // 1) 段落折行：上一行排满、没有句末标点，下一行从左边界开始
        // 行数少、看不出明显右边界时（best < 3），退一步：排到版心宽度的八成以上也算排满
        const reach = lc.px1 >= right - h * 1.5 || (best < 3 && lc.plen > 15 && lc.px1 >= left + (right - left) * 0.8);
        const full = reach && lc.plen > 8 && l.px0 <= left + h * 3 && n.x0 <= left + h * 1.5;
        // 上一行以"有限公司"等结尾：名字已经完整，多半是一行一个的名单，不拼
        const latinToCjk = /[A-Za-z.]$/.test(lc.text) && /^[一-龥（(]/.test(ntext);   // 英文名一行、中文名下一行：是两个名字
        const para = full && !latinToCjk && !END_SENT.test(lc.text) && !ORG_END.test(lc.text) && !NUMBERED.test(ntext);
        // 2) 行首是逗号句号：一定是上一行的延续
        const punct = /^[，。、；：！？）」』”%]/.test(ntext);
        // 3) 下一行以"有限公司 / 责任公司……"开头，上一行以汉字或右括号结尾：公司名被折断了
        const suffix = SUFFIX_START.test(ntext) && /[一-龥）)]$/.test(lc.text) && Math.abs(n.x0 - l.px0) < h * 3;
        if (para || punct || suffix) {
          lc.text += glue(lc.text, ntext) + ntext;
          lc.px1 = n.x1; lc.plen = ntext.length; l.py = n.y; l.px0 = n.x0; l.px1 = n.x1;
          continue;
        }
      }
      // 4) 表格单元格里的折行：下一行的每个格子都和上一行某个格子左对齐、都不是数字，且每一对都像"没写完"
      if (n.y < l.py && (l.py - n.y) < h * 1.8 && Math.abs(n.h - h) < h * 0.25 && n.cells.length <= l.cells.length) {
        const pairs = [];
        let ok = true;
        for (const nc of n.cells) {
          const lc = l.cells.find(c => Math.abs(c.x0 - nc.x0) < h * 0.6);
          if (!lc || pairs.some(p => p[0] === lc) || NUMERIC.test(nc.text) || NUMBERED.test(nc.text)) { ok = false; break; }
          const forced = SUFFIX_START.test(nc.text) && /[一-龥）)]$/.test(lc.text);
          const basic = !END_SENT.test(lc.text) && !ORG_END.test(lc.text) && /[一-龥]$/.test(lc.text) && /^[一-龥（(]/.test(nc.text);
          const filled = lc.plen >= 5 && lc.px1 >= colRight(lc.x0) - h * 0.5 && nc.x1 <= lc.px1 + h * 0.3;
          if (!(forced || (basic && (INCOMPLETE.test(lc.text) || filled)))) { ok = false; break; }
          pairs.push([lc, nc]);
        }
        if (ok && pairs.length) {
          for (const [lc, nc] of pairs) { lc.text += glue(lc.text, nc.text) + nc.text; lc.px1 = nc.x1; lc.plen = nc.text.length; }
          l.py = n.y;
          continue;
        }
      }
      res.push(n);
    }
    return res.map(l => l.cells.map(c => c.text).join('\t')).join('\n');
  }

  function layoutPage(runs) {
    // 去掉"描两遍"造成的重复（伪粗体）
    const rs = [];
    for (const r of runs) {
      const p = rs[rs.length - 1];
      if (p && p.s === r.s && Math.abs(p.x0 - r.x0) < r.h * 0.3 && Math.abs(p.y - r.y) < r.h * 0.3) continue;
      rs.push(r);
    }
    // 不同方向的文字（整页旋转的表格）分开排版
    const groups = new Map();
    for (const r of rs) { if (!groups.has(r.k || 0)) groups.set(r.k || 0, []); groups.get(r.k || 0).push(r); }
    return [...groups.values()].map(layoutGroup).filter(Boolean).join('\n');
  }

  /* ---------------- 页面遍历 ---------------- */
  const MAX_PAGES = 5000, MAX_CHARS = 3000000, MAX_CONTENT = 64 * 1024 * 1024, MAX_PARSE = 300 * 1024 * 1024;
  function collectPages(doc) {
    const pages = [];
    const root = resolveSync(doc, doc.trailer.Root);
    const seen = new Set();
    const stack = [[root && root.Pages, {}]];
    while (stack.length && root && root.Pages) {
      const [ref, inherited] = stack.pop();
      if (pages.length >= MAX_PAGES) break;
      const id = ref instanceof Ref ? ref.num : null;
      if (id !== null) { if (seen.has(id)) continue; seen.add(id); }
      const node = resolveSync(doc, ref);
      if (!node || typeof node !== 'object') continue;
      const inh = Object.assign({}, inherited);
      if (node.Resources) inh.Resources = node.Resources;
      const type = node.Type instanceof Name ? node.Type.name : '';
      const kids = resolveSync(doc, node.Kids);
      if (type === 'Pages' || kids instanceof Array) {
        if (kids instanceof Array) for (let j = kids.length - 1; j >= 0; j--) stack.push([kids[j], inh]);
      } else pages.push({ node: node, res: inh.Resources });
    }
    if (!pages.length) {
      // 页树坏了：退而求其次，按文件顺序收集所有页面对象
      for (const ent of doc.objs.values()) {
        const v = ent.val;
        if (v && v.Type instanceof Name && v.Type.name === 'Page' && pages.length < MAX_PAGES) pages.push({ node: v, res: v.Resources });
      }
    }
    return pages;
  }

  async function extract(buf, opts) {
    opts = opts || {};
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try {
      return await extractInner(u8, opts);
    } catch (e) {
      // 结构异常（嵌套太深等）统一成中文提示
      if (e instanceof RangeError) throw new Error('PDF 结构嵌套过深或异常，无法读取。可以在阅读器里"另存为"一份再试。');
      throw e;
    }
  }
  async function extractInner(u8, opts) {
    const doc = await openDoc(u8);
    const pages = collectPages(doc);
    if (!pages.length) throw new Error('没有找到页面，文件可能已损坏');
    const stats = { chars: 0, images: 0, rotated: 0, formActive: new Set(), formCalls: 0, pages: pages.length, failed: 0 };
    const parts = [], emptyPages = [];
    let truncated = 0, parsed = 0;
    for (let i = 0; i < pages.length; i++) {
      // 字数或累计解析量超限就停（多页反复引用同一个大内容流时，单页上限拦不住）
      if (stats.chars > MAX_CHARS || parsed > MAX_PARSE) { truncated = i; break; }
      const pg = pages[i];
      const cv = resolveSync(doc, pg.node.Contents);
      const refs = cv instanceof Array ? cv : [pg.node.Contents];
      const chunks = [], seenRef = new Set();
      let total = 0;
      for (const r of (refs || [])) {
        if (!(r instanceof Ref) || seenRef.has(r.num)) continue;     // 同一个内容流重复引用只读一次
        seenRef.add(r.num);
        try {
          const c = await streamBytes(doc, doc.objs.get(r.num));
          total += c.length + 1;
          if (total > MAX_CONTENT) throw new LimitError('PDF 某一页的内容超过 64MB，已停止读取（文件可能被故意构造过）。');
          chunks.push(c);
        } catch (e) { if (e && e.limit) throw e; stats.failed++; }
      }
      parsed += total;
      const all = new Uint8Array(total); let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; all[o++] = 10; }
      const runs = [];
      stats.formActive = new Set(); stats.formCalls = 0;
      const before = stats.chars;
      try { await runContent(doc, all, pg.res, [1, 0, 0, 1, 0, 0], runs, 0, stats); } catch (e) { if (e && e.limit) throw e; stats.failed++; }
      const txt = layoutPage(runs);
      if (stats.chars - before < 5) emptyPages.push(i + 1);
      parts.push(txt);
      if (opts.onProgress && i % 10 === 0) opts.onProgress(i + 1, pages.length);
    }
    if (stats.chars < Math.max(30, pages.length * 15)) {
      const err = new Error(stats.images
        ? '这份 PDF 是扫描件（页面是图片，没有文字层），本工具不做 OCR。请先用 WPS / Adobe 等软件识别成文字，再粘贴进来。'
        : '这份 PDF 里读不到文字。可能是字体没有附带编码表，请在阅读器里全选复制正文后粘贴进来。');
      err.code = 'NO_TEXT';
      throw err;
    }
    const text = parts.map((p, i) => (pages.length > 1 ? '—— 第 ' + (i + 1) + ' 页 ——\n' : '') + p).join('\n\n');
    const warnings = [];
    if (emptyPages.length) warnings.push('第 ' + compactPages(emptyPages) + ' 页没有读到文字（可能是扫描页或图片），这些页没有被处理');
    if (truncated) warnings.push('文件过大（文字超过 300 万字或页面内容超过 300MB），只读取了前 ' + truncated + ' 页');
    if (stats.rotated > 50) warnings.push('有 ' + stats.rotated + ' 个斜排的字（通常是水印）没有读取');
    return { text: text, pages: pages.length, emptyPages: emptyPages, warnings: warnings, chars: stats.chars, images: stats.images };
  }
  function compactPages(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      let j = i; while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++;
      out.push(j > i ? arr[i] + '–' + arr[j] : String(arr[i])); i = j;
      if (out.length >= 8) { if (j < arr.length - 1) out.push('等'); break; }
    }
    return out.join('、');
  }

  const api = { extract: extract, _md5: md5, _rc4: rc4, _parseCMap: parseCMap, _layoutPage: layoutPage };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DemaskPDF = api;
})(typeof self !== 'undefined' ? self : this);
