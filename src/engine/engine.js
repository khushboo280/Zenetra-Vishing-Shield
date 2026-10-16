/* Vishing Shield engine: lexicon, scoring, fusion, alert state machine. (Live call controller: live.js)
   Runs in the browser and in Node (for tests). No DOM access in here. */
(function (root) {
  'use strict';

  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const sig = (x) => 1 / (1 + Math.exp(-x));
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = (src) => new RegExp(src, 'giu');

  /* ---------- lexicon (English, Roman Hindi, Devanagari) ---------- */
  const LEX = {
    otp: R("\\botp\\b|\\bo\\.t\\.p\\b|ओटीपी|\\bpin\\b|पिन|\\bcvv\\b|सीवीवी|card (?:number|details)|कार्ड (?:का )?(?:नंबर|डिटेल)|verification code|security code|\\bpassword\\b|पासवर्ड|one[- ]time"),
    ask: R("\\bbata\\w*|\\bbol\\w*|\\bbhej\\w*|\\bshare\\b|\\bsend\\b|\\btell\\b|\\bgive\\b|\\bread\\b|\\bprovide\\b|\\benter\\b|\\bdijiye\\w*|\\bdena\\b|\\bchahiye\\b|\\bneed\\b|\\bmaang\\w*|\\bpoochh?\\w*|\\basks? for\\b|बता\\S*|भेज\\S*|बोल\\S*|दीजिए|चाहिए|पूछ\\S*|माँग\\S*"),
    remote: R("any ?desk|team ?viewer|quick ?support|rustdesk|screen ?share|remote (?:access|support)|एनीडेस्क|टीमव्यूअर|स्क्रीन शेयर|\\bapp\\b|ऐप"),
    install: R("\\binstall\\w*|\\bdownload\\w*|इंस्टॉल|डाउनलोड|\\bkholo\\b|\\bchalu\\b"),
    authority: R("\\b(?:bank|sbi|hdfc|icici|axis|rbi|kyc|police|cbi|cyber ?crime|crime branch|narcotics|customs|courier|fedex|dhl|trai|income tax|tax refund|inspector|officer|head office|customer care|department|ministry|court|insurance)\\b|बैंक|पुलिस|सीबीआई|साइबर ?क्राइम|क्राइम ब्रांच|इंस्पेक्टर|केवाईसी|अधिकारी|नारकोटिक्स|कस्टम|कूरियर|विभाग|कोर्ट"),
    threat: R("\\bblock(?:ed)?\\b|\\bfreez\\w*|\\bfrozen\\b|\\bsuspend\\w*|\\barrest\\w*|\\bwarrant\\b|\\bfir\\b|legal action|\\bjail\\b|\\bseized\\b|\\bpenalty\\b|blacklist|\\bdrugs\\b|गिरफ्तार\\S*|वारंट|ब्लॉक|केस दर्ज|जेल|ड्रग्स|पकड़ा"),
    urgency: R("\\babhi\\b|\\bturant\\b|\\bimmediately\\b|\\burgent\\w*|right now|\\bjaldi\\b|within \\d+ ?(?:min\\w*|hours?|ghante)|aaj (?:hi|raat)|tonight|last chance|\\basap\\b|at once|\\bhurry\\b|\\bexpire\\w*|तुरंत|अभी|फौरन|जल्दी|आज (?:ही|रात)|\\bemergency\\b|bahut zaroori|bahut urgent"),
    secrecy: R("kisi ko[^.?!।]{0,25}\\bmat\\b|\\w+ ko mat bata\\w*|don'?t tell (?:anyone|anybody)|do not tell (?:anyone|anybody)|keep (?:this|it) (?:a )?(?:secret|confidential)|\\bconfidential\\b|call (?:mat )?kaat\\w*|(?:don'?t|do not) hang up|stay on (?:the )?line|line par (?:bane|rahiye)|video call par|\\bsecret\\b|गोपनीय|किसी को[^.?!।]{0,12}(?:न|मत)[^.?!।]{0,12}|फोन (?:नहीं )?काट\\S*|कॉल (?:मत )?काट\\S*|वीडियो कॉल पर|लाइन पर बने"),
    payment: R("\\btransfer\\w*|\\bupi\\b|\\brtgs\\b|\\bneft\\b|\\bimps\\b|\\bpaise\\b|\\bpaisa\\b|\\bpayment\\b|\\brupe(?:es|e)\\b|\\brupa(?:ye|iye|iya)\\b|\\brs\\.? ?\\d|₹|\\blakh\\b|\\bhazaar\\b|\\bhajar\\b|safe account|processing fee|verification fee|gift card|bitcoin|पैसे|ट्रांसफर\\S*|खाते में|सुरक्षित खाता|जांच खाते|रुपये|हज़ार|लाख"),
    payverb: R("\\bbhej\\w*|\\btransfer\\w*|\\bpay\\b|\\bsend\\b|\\bde(?:na|do|dijiye|dijiyega)\\b|\\bkariye\\b|\\bkaro\\b|\\bchahiye\\b|चाहिए|भेज\\S*|ट्रांसफर\\S*|दे(?:ना|दो|दीजिए)|\\bdeposit\\b"),
    famKin: R("\\b(?:bhaiya|bhai|didi|behen|bahen|mummy|mama|mom|dad|papa|pappa|beta|bete|bhabhi|chacha|chachi|mausi|nana|nani|dada|dadi|dost|yaar|bro|buddy|brother|sister|beti|son)\\b|भैया|भाई|दीदी|बहन|मम्मी|पापा|बेटा|बेटी|यार|दोस्त|चाचा|मामा|दादी|नानी"),
    famMem: R("\\byaad hai\\b|याद है|remember when|last time|pichh?li baar|\\bkheer\\b|\\bshaadi\\b|शादी|birthday|\\bparty\\b|\\bghar\\b|घर"),
    famInf: R("\\btum\\b|\\btu\\b|\\btera\\b|\\btumhare\\b|तुम|how are you|\\bkaise ho\\b|\\bkaisi ho\\b|कैसे हो|miss you|love you|\\bchai\\b|\\bdinner\\b|\\blunch\\b|\\bwallet\\b|\\bnaya number\\b"),
    formal: R("\\b(?:sir|madam|ma'?am|customer|reference number|dear|registered|account number|verification)\\b|सर|मैडम|ग्राहक"),
    warm: R("\\bthanks?\\b|thank you|dhanyavaad|dhanyawad|shukriya|धन्यवाद|शुक्रिया|congrat\\w*|\\bbadhai\\b|बधाई|\\blove\\b|\\bmiss\\b|\\bhappy\\b|\\bkhushi\\b|\\bsubh\\b|शुभ"),
    anxious: R("dar lag\\w*|ghabra\\w*|scared|afraid|worried|\\bpanic\\b|oh god|please help|help me|मदद|डर लग\\S*|घबरा\\S*|\\bdar raha\\b"),
    comply: R("my otp is|otp hai|the code is|code is|otp ye hai|ओटीपी है|\\bye raha\\b|bata raha|bolta hoon|\\breading\\b|\\bdownloading\\b|\\binstalling\\b|\\binstalled\\b|bhej raha|bhej diya|transferring|sending now|kar diya|kar raha hoon|बता रहा|भेज रहा|कर रहा हूँ|मैं फोन नहीं काटूँगा"),
  };
  const DIGITS = /(?:\b\d[\s,.-]*){4,8}(?!\s*(?:rupe|rs|hazaar|hajar|baje))/i;
  const NEG_PRE = /(?:^|\s)(?:never|don'?t|do not|dont|not|na|nahi|nahin|mat|kabhi)(?:\s|$)|(?:^|\s)(?:न|मत)(?:\s|$)|नहीं|कभी/i;
  const NEG_POST = /^\s*(?:na|nahi|nahin|mat|n't|not)\b|^\s*\w+\s+(?:na|nahi|mat)\b|^\s*(?:न|मत|नहीं)/i;

  const CAT_LABEL = {
    otp: 'OTP / PIN / card details asked',
    otpwarn: 'Credentials mentioned as a warning',
    remote: 'Remote-access app',
    secrecy: 'Secrecy / isolation',
    threat: 'Threat or fear',
    urgency: 'Urgency',
    payment: 'Payment demand',
    authority: 'Authority claim',
    family: 'Personal / family cue',
  };
  const PRIORITY = ['otp', 'otpwarn', 'remote', 'secrecy', 'threat', 'urgency', 'payment', 'authority', 'family'];

  function matches(rx, s) {
    const out = []; rx.lastIndex = 0; let m;
    while ((m = rx.exec(s))) { out.push({ i: m.index, l: m[0].length, t: m[0] }); if (m[0].length === 0) rx.lastIndex++; }
    return out;
  }
  function negated(s, i, l) {
    const pre = s.slice(Math.max(0, i - 18), i).split(/[,;:]/).pop();
    return NEG_PRE.test(pre) || NEG_POST.test(s.slice(i + l, i + l + 14));
  }

  /* Scan one text: returns highlight segments and whether it contains hard asks. */
  function scan(text) {
    const segs = []; const asks = { otp: false, remote: false, pay: false };
    const sRx = /[^.?!।\n]+[.?!।]?/g; let sm;
    while ((sm = sRx.exec(text))) {
      const s = sm[0], off = sm.index; if (!s.trim()) continue;
      const complete = /[.?!।]\s*$/.test(s);
      const settled = (m) => complete || s.length - (m.i + m.l) >= 14;
      const otps = matches(LEX.otp, s);
      const askVerbs = matches(LEX.ask, s);
      let otpAsk = false;
      for (const o of otps) for (const a of askVerbs) {
        if (Math.abs(a.i - o.i) <= 70 && settled(a) && !negated(s, a.i, a.l)) otpAsk = true;
      }
      const rem = matches(LEX.remote, s), ins = matches(LEX.install, s);
      let remAsk = false;
      for (const r of rem) for (const n of ins) { if (Math.abs(r.i - n.i) <= 60 && settled(n) && !negated(s, n.i, n.l)) remAsk = true; }
      const pays = matches(LEX.payment, s), pv = matches(LEX.payverb, s);
      let payAsk = false;
      if (pays.length) for (const v of pv) { if (settled(v) && !negated(s, v.i, v.l)) payAsk = true; }
      if (otpAsk) asks.otp = true; if (remAsk) asks.remote = true; if (payAsk) asks.pay = true;
      const add = (cat, list) => list.forEach((m) => segs.push({ s: off + m.i, e: off + m.i + m.l, cat, t: m.t }));
      add(otpAsk ? 'otp' : 'otpwarn', otps);
      const strongRem = rem.filter((r) => !/^(app|ऐप)$/i.test(r.t) || remAsk);
      if (remAsk || strongRem.some((r) => !/^(app|ऐप)$/i.test(r.t))) add('remote', strongRem);
      for (const c of ['secrecy', 'threat', 'urgency', 'authority']) add(c, matches(LEX[c], s));
      add('payment', pays);
      for (const c of ['famKin', 'famMem']) add('family', matches(LEX[c], s));
    }
    segs.sort((a, b) => a.s - b.s || PRIORITY.indexOf(a.cat) - PRIORITY.indexOf(b.cat));
    const clean = []; let end = -1;
    for (const g of segs) { if (g.s >= end) { clean.push(g); end = g.e; } }
    return { segs: clean, asks, all: segs };
  }
  function tag(text) { return scan(text).segs; }

  function langOf(text) {
    const dev = (text.match(/[ऀ-ॿ]/g) || []).length;
    const lat = (text.match(/[A-Za-z]/g) || []).length;
    if (dev + lat === 0) return 'en';
    if (dev / (dev + lat) > 0.3) return 'hi';
    const words = text.toLowerCase().match(/[a-z']+/g) || [];
    const hn = new Set(['hai', 'hain', 'nahi', 'aap', 'aapka', 'aapke', 'mera', 'meri', 'mujhe', 'karo', 'kariye', 'kijiye', 'bata', 'abhi', 'kya', 'raha', 'rahi', 'toh', 'mein', 'haan', 'theek', 'beta', 'papa', 'mummy', 'didi', 'kal', 'aaj', 'bhej', 'dena', 'dijiye', 'boliye', 'bataiye', 'hoon', 'hoga', 'chahiye', 'ek', 'par', 'ko', 'ka', 'ki', 'ke', 'se', 'sir', 'ji', 'mat', 'kisi', 'bahut', 'zaroor', 'achha', 'dhanyavaad', 'kripya', 'karein', 'sakte', 'ho', 'tum', 'main', 'maine', 'yeh', 'ye', 'wo', 'aur', 'phir']);
    const n = words.filter((w) => hn.has(w)).length;
    return n >= 3 && n / Math.max(1, words.length) > 0.16 ? 'hn' : 'en';
  }
  function convLang(shown, override) {
    if (override && override !== 'auto') return override;
    const last = shown.filter((t) => t.text.trim()).slice(-3);
    if (!last.length) return 'en';
    let hi = 0, en = 0; last.forEach((t) => { const l = langOf(t.text); if (l === 'en') en++; else hi++; });
    return hi > en ? 'hi' : en > hi ? 'en' : (langOf(last[last.length - 1].text) === 'en' ? 'en' : 'hi');
  }

  /* ---------- alert audio scripts ---------- */
  const ALERTS = {
    hi: {
      receiver: 'सावधान। यह कॉल धोखाधड़ी हो सकती है। कृपया अपना OTP, PIN, CVV या कार्ड की जानकारी किसी को न बताएं। कोई ऐप इंस्टॉल न करें और पैसे ट्रांसफर न करें। कॉल काटकर बैंक के आधिकारिक नंबर पर खुद कॉल करें। शिकायत के लिए 1930 पर कॉल करें।',
      caller: 'सूचना: इस कॉल को संदिग्ध धोखाधड़ी के रूप में चिह्नित किया गया है और इसकी निगरानी की जा रही है। धोखाधड़ी की शिकायत होने पर इस बातचीत का ट्रांसक्रिप्ट साइबर क्राइम अधिकारियों को जांच के लिए दिया जा सकता है।',
      whisper: 'सावधान। यह कॉल संदिग्ध लग रही है। अभी OTP या कोई जानकारी साझा न करें।',
    },
    en: {
      receiver: 'Warning. This call is likely a fraud. Do not share your OTP, PIN, CVV or card details. Do not install any app or transfer money. Hang up and call your bank yourself on its official number. To report, call 1930.',
      caller: 'Notice: This call has been flagged as suspected fraud and is being monitored. If a fraud complaint is filed, a transcript of this conversation may be shared with cybercrime authorities for investigation.',
      whisper: 'Caution. This call looks suspicious. Do not share any OTP or personal details right now.',
    },
  };

  /* ---------- feature extraction from the transcript so far ---------- */
  function uniq(segs, cat) {
    const s = new Set(); segs.filter((g) => g.cat === cat).forEach((g) => s.add(g.t.toLowerCase())); return s.size;
  }
  function analyze(shown) {
    const caller = shown.filter((t) => t.who === 'caller');
    const receiver = shown.filter((t) => t.who === 'receiver');
    const cs = []; const asks = { otp: false, remote: false, pay: false };
    caller.forEach((t, k) => {
      const sc = scan(t.text + (t.partial ? '' : '.')); sc.all.forEach((g) => cs.push(g));
      for (const key of ['otp', 'remote', 'pay']) if (sc.asks[key]) asks[key] = true;
    });
    const rs = []; receiver.forEach((t) => scan(t.text).all.forEach((g) => rs.push(g)));
    const auth = Math.min(3, uniq(cs, 'authority')), threat = Math.min(3, uniq(cs, 'threat'));
    const urg = Math.min(3, uniq(cs, 'urgency')), sec = Math.min(2, uniq(cs, 'secrecy'));
    const hardAsk = asks.otp || asks.remote;
    const I = clamp((asks.otp ? 62 : 0) + (asks.remote ? 58 : 0) + (asks.pay ? 38 : 0) + auth * 7 + threat * 9);
    const M = clamp(urg * 13 + sec * 24 + threat * 9 + auth * 6);
    const rText = receiver.map((t) => t.text).join(' ');
    const allText = shown.map((t) => t.text).join(' ');
    const anx = matches(LEX.anxious, rText).length;
    const warm = matches(LEX.warm, allText).length;
    const S = clamp(threat * 14 + urg * 5 + sec * 6 + anx * 12 - warm * 10);
    const stages = { authority: auth >= 1, pressure: threat >= 1 || urg >= 1, secrecy: sec >= 1, demand: hardAsk || asks.pay };
    const stageCount = Object.values(stages).filter(Boolean).length;
    const all = cs.concat(rs);
    const kin = Math.min(3, uniq(all, 'family')) ;
    const kinSet = new Set(); const memSet = new Set(); const infSet = new Set(); const formSet = new Set();
    [caller, receiver].forEach((arr) => arr.forEach((t) => {
      matches(LEX.famKin, t.text).forEach((m) => kinSet.add(m.t.toLowerCase()));
      matches(LEX.famMem, t.text).forEach((m) => memSet.add(m.t.toLowerCase()));
      matches(LEX.famInf, t.text).forEach((m) => infSet.add(m.t.toLowerCase()));
      matches(LEX.formal, t.text).forEach((m) => formSet.add(m.t.toLowerCase()));
    }));
    const Fam = clamp(Math.min(54, kinSet.size * 18) + Math.min(28, memSet.size * 14) + Math.min(24, infSet.size * 8) - Math.min(21, formSet.size * 7));
    let Rc = 0;
    if (stages.demand) {
      const dig = receiver.filter((t) => DIGITS.test(t.text)).length;
      const ph = matches(LEX.comply, rText).length;
      Rc = clamp(dig * 55 + Math.min(2, ph) * 30);
    }
    return { I, M, S, Fam, R: Rc, hardAsk, asks, stages, stageCount, counts: { auth, threat, urg, sec, kin }, kin };
  }

  const W = { b: -6.0, I: 0.05, M: 0.035, S: 0.010, H: 0.012, D: 0.040, C: 0.020, R: 0.025, St: 0.45, Fam: 0.040 };
  function fuse(f) {
    const famEff = f.Fam * (1 - f.D / 100) * (f.hardAsk ? 0 : 1);
    const terms = {
      Intent: W.I * f.I, Manipulation: W.M * f.M, Sentiment: W.S * f.S, Hesitation: W.H * f.H,
      Deepfake: W.D * f.D, 'Caller number': W.C * f.C, Compliance: W.R * f.R, 'Scam stages': W.St * f.stageCount,
      Family: -W.Fam * famEff,
    };
    const logit = W.b + Object.values(terms).reduce((a, b) => a + b, 0);
    return { F: 100 * sig(logit), terms, famEff, logit };
  }

  /* ---------- constants shared with the live call controller (live.js) ---------- */
  const TICK = 0.25, HYST = 3, COOLDOWN = 6, WPS = 2.7;
  const LEVELS = ['NONE', 'WATCH', 'WARN', 'INTERVENE'];
  const DEFAULT_CFG = { th: { watch: 30, warn: 55, intervene: 80 }, trusted: true, langOverride: 'auto' };
  function callerBase(c) {
    if (!c) return 40;
    return ({ unknown: 40, intl: 65, saved: 0, business: 20 }[c.kind] || 40) + (c.spoofedCli ? 25 : 0);
  }

  const api = { clamp, sig, rng, LEX, scan, tag, langOf, convLang, ALERTS, analyze, fuse, W, LEVELS, DEFAULT_CFG, CAT_LABEL, WPS, TICK, HYST, COOLDOWN, callerBase };
  root.VSEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
export default globalThis.VSEngine;
