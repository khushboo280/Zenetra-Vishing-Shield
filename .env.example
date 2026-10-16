// npm run setup : asks for every API key the app needs, tests it, and writes .env
// (works the same on Windows, Mac and Linux). Keys live ONLY in .env, which is git-ignored and never sent to the browser.
import fs from 'node:fs';
import readline from 'node:readline/promises';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('close', () => { if (!done) { console.log('\nSetup cancelled: nothing was saved.'); process.exit(1); } });
let done = false;
let env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '';
const set = (k, v) => { env = new RegExp('^' + k + '=', 'm').test(env) ? env.replace(new RegExp('^' + k + '=.*$', 'm'), k + '=' + v) : env + (env && !env.endsWith('\n') ? '\n' : '') + k + '=' + v + '\n'; };
const mask = (v) => (v ? v.slice(0, 4) + '…' + v.slice(-3) : '');
async function ask(k, label, { required = false, hint = '' } = {}) {
  const cur = get(k);
  for (;;) {
    const a = (await rl.question(`${label}${hint ? '\n  ' + hint : ''}\n  ${k}${cur ? ` [Enter = keep ${mask(cur)}]` : required ? ' (required)' : ' [Enter = skip]'}: `)).trim().replace(/^["']|["']$/g, '');
    if (a) { set(k, a); return a; }
    if (cur) return cur;
    if (!required) return '';
    console.log('  This one is required.\n');
  }
}

const GET = { SARVAM_API_KEY: 'https://dashboard.sarvam.ai (API keys)', OPENAI_API_KEY: 'https://platform.openai.com/api-keys', GROQ_API_KEY: 'https://console.groq.com/keys', DEEPGRAM_API_KEY: 'https://console.deepgram.com', ELEVENLABS_API_KEY: 'https://elevenlabs.io/app/settings/api-keys', GEMINI_API_KEY: 'https://aistudio.google.com/apikey', XAI_API_KEY: 'https://console.x.ai', LLAMA_API_KEY: 'Meta Llama API key (llama.developer.meta.com), or Together / OpenRouter key; for local Ollama type any word, e.g. ollama' };
const STT = { sarvam: ['SARVAM_API_KEY', 'Sarvam (best for Hindi / Hinglish)'], openai: ['OPENAI_API_KEY', 'OpenAI gpt-4o-transcribe'], whisper: ['OPENAI_API_KEY', 'OpenAI Whisper'], groq: ['GROQ_API_KEY', 'Groq Whisper large-v3 (fast)'], deepgram: ['DEEPGRAM_API_KEY', 'Deepgram nova-3'], elevenlabs: ['ELEVENLABS_API_KEY', 'ElevenLabs Scribe'] };
const LLM = { gemini: ['GEMINI_API_KEY', 'Google Gemini'], openai: ['OPENAI_API_KEY', 'OpenAI GPT'], grok: ['XAI_API_KEY', 'xAI Grok'], llama: ['LLAMA_API_KEY', 'Meta Llama (also Together / OpenRouter / Ollama via LLAMA_BASE_URL)'], groq: ['GROQ_API_KEY', 'Groq Llama'] };
async function pick(k, label, table, dflt) {
  const cur = get(k) || dflt, names = Object.keys(table);
  console.log(`\n${label}`); names.forEach((n, i) => console.log(`  ${i + 1}) ${n.padEnd(9)} ${table[n][1]}${n === cur ? '   <- current' : ''}`));
  for (;;) {
    const a = (await rl.question(`  ${k} [Enter = ${cur}]: `)).trim().toLowerCase(); const v = !a ? cur : names[+a - 1] || (table[a] ? a : '');
    if (v) { set(k, v); return v; } console.log('  Pick a number or a name from the list.');
  }
}

console.log('\nVishing Shield setup. Three API slots, each can use any provider (change later by re-running this):');
console.log('  API1 = speech-to-text for the RECEIVER\'s microphone\n  API2 = speech-to-text for the CALLER\'s audio\n  API3 = the AI observer that reads the transcript, scores the call and decides alerts');
const a1 = await pick('STT_API1', 'API1: who transcribes the receiver (your) microphone?', STT, 'sarvam');
const a2 = await pick('STT_API2', 'API2: who transcribes the caller?', STT, a1);
const a3 = await pick('LLM_API3', 'API3: which AI observer scores the call?', LLM, 'gemini');
console.log('\nMain language of your calls (stops random-language text in the transcript):\n  1) Hindi + English mixed / auto  [default]\n  2) Hindi\n  3) English');
{ const a = (await rl.question('  STT_LANGUAGE [Enter = 1]: ')).trim(); set('STT_LANGUAGE', a === '2' || a === 'hi' ? 'hi' : a === '3' || a === 'en' ? 'en' : ''); }
const keys = [...new Set([STT[a1][0], STT[a2][0], LLM[a3][0]])];
console.log('\nKeys needed for your choice (stored only in .env on this computer):');
const WANT = { SARVAM_API_KEY: '', GEMINI_API_KEY: 'gemini', OPENAI_API_KEY: 'openai', GROQ_API_KEY: 'groq', XAI_API_KEY: 'xai', LLAMA_API_KEY: '' };
const { keyFamily } = await import('../server/providers/common.js');
for (const k of keys) {
  console.log(); const v = await ask(k, `${k}`, { required: true, hint: GET[k] }); const f = keyFamily(v);
  if (f && WANT[k] !== undefined && WANT[k] !== '' && f !== WANT[k]) console.log(`  ⚠ This looks like a ${f} key, but it is stored as ${k}. Keys only work on the service that issued them.`);
  if (k === 'LLAMA_API_KEY' && f === 'groq') console.log('  ✔ Groq key detected: Llama will run on Groq (llama-3.3-70b-versatile).');
  if (k === 'LLAMA_API_KEY' && f === 'openrouter') console.log('  ✔ OpenRouter key detected: Llama will run on OpenRouter.');
  if (k === 'LLAMA_API_KEY' && ['gemini', 'openai', 'xai'].includes(f)) console.log(`  ⚠ A ${f} key cannot run Llama. Pick a Llama host (Meta Llama API / Groq / OpenRouter / Together) and paste ITS key, or choose API3 = ${f === 'xai' ? 'grok' : f}.`);
}
set('CALLER_STT_SOURCE', get('CALLER_STT_SOURCE') || 'remote');
console.log('\nSpoken alerts use the first voice that is available: ElevenLabs, OpenAI or Gemini key (whichever you entered). With none of them, a bundled voice + the browser\'s own speech is used.');

fs.writeFileSync('.env', env);
done = true; rl.close();
console.log('\nTesting your keys…');
for (const k of keys) process.env[k] = get(k);
Object.assign(process.env, { STT_API1: a1, STT_API2: a2, LLM_API3: a3 });
try {
  const { checkAll } = await import('../server/providers/index.js'); const r = await checkAll();
  for (const [slot, v] of Object.entries(r)) console.log(`  ${v.ok ? '✔' : '✖'} ${slot.toUpperCase()} ${v.label}${v.ok ? ' key works' : ': ' + v.error}`);
} catch (e) { console.log('  ? could not test from here (' + e.message + '); the keys were still saved'); }
console.log('\nSaved to .env (never share or commit this file).\nNext:  npm start\n');
