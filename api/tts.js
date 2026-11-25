// Vercel Function: نص -> صوت رجالي (Gemini TTS) مع إعادة المحاولة وكشف الصوت المبتور
const MODELS = [process.env.GEMINI_TTS_MODEL, 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'].filter(Boolean);
const VOICE = process.env.GEMINI_VOICE || 'Charon'; // رجالية: Charon, Orus, Fenrir, Algenib
const RETRY = [400, 404, 429, 500, 503, 504];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

function splitText(text, max = 400) {
  const sentences = text.split(/(?<=[.!؟?،؛:])\s+/);
  const parts = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) { parts.push(cur); cur = ''; }
      let w = '';
      for (const word of s.split(/\s+/)) {
        if ((w + ' ' + word).length > max) { parts.push(w.trim()); w = word; } else w += ' ' + word;
      }
      cur = w.trim();
    } else if ((cur + ' ' + s).trim().length > max) { parts.push(cur); cur = s; }
    else cur = (cur + ' ' + s).trim();
  }
  if (cur) parts.push(cur);
  return parts.length ? parts : [text];
}

async function synth(key, text) {
  const prompt = 'Say in a calm, clear, warm male teacher voice, at a steady medium pace, in Modern Standard Arabic: ' + text;
  let best = null, lastErr = '', lastStatus = 502;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res = null;
    for (const model of MODELS) {
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
            },
          }),
        });
      } catch (e) { lastErr = model + ': ' + e; continue; }
      if (r.ok) {
        const d = await r.json();
        const part = (d?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
        if (part) {
          res = {
            pcm: Buffer.from(part.inlineData.data, 'base64'),
            rate: Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000,
          };
          break;
        }
        lastErr = model + ': no audio';
        continue;
      }
      lastStatus = r.status;
      lastErr = model + ' ' + r.status + ': ' + (await r.text()).slice(0, 200);
      if (!RETRY.includes(r.status)) break;
    }
    if (res) {
      if (!best || res.pcm.length > best.pcm.length) best = res;
      const secs = res.pcm.length / (res.rate * 2);
      if (secs >= Math.max(1.2, text.length / 24)) return res; // صوت كامل
    } else await sleep(1200 * (attempt + 1));
  }
  if (best) return best; // أطول نسخة حصلنا عليها
  const e = new Error(lastErr || 'TTS failed');
  e.status = lastStatus;
  throw e;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  const text = String((req.body && req.body.text) || '').trim();
  if (!text || text.length > 1500) return res.status(400).json({ error: 'Bad text' });

  try {
    const parts = text.length > 480 ? splitText(text, 400) : [text];
    const results = await Promise.all(parts.map((p) => synth(key, p)));
    const rate = results[0].rate;
    const gap = Buffer.alloc(Math.floor(rate * 0.2) * 2); // 0.2s صمت بين المقاطع
    const pcm = Buffer.concat(results.flatMap((r, i) => (i ? [gap, r.pcm] : [r.pcm])));

    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(pcm.length, 40);

    res.setHeader('Content-Type', 'audio/wav');
    res.status(200).send(Buffer.concat([h, pcm]));
  } catch (e) {
    res.status(e.status === 429 ? 429 : 502).json({ error: 'Gemini TTS error', detail: String(e.message || e).slice(0, 300) });
  }
};
