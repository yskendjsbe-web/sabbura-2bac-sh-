// Vercel Serverless Function: يحوّل النص إلى صوت رجالي عبر Gemini TTS
// المفتاح يبقى في الخادم فقط (متغير بيئة GEMINI_API_KEY) ولا يظهر للمتصفح.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

  const text = String((req.body && req.body.text) || '').trim();
  if (!text || text.length > 1200) return res.status(400).json({ error: 'Bad text' });

  const models = [process.env.GEMINI_TTS_MODEL, 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'].filter(Boolean);
  const voice = process.env.GEMINI_VOICE || 'Charon'; // أصوات رجالية: Charon, Orus, Fenrir, Algenib

  const prompt =
    'Say in a calm, clear, warm male teacher voice, at a steady medium pace, in Modern Standard Arabic: ' + text;

  try {
    let r, lastErr = '';
    for (const model of models) {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
          }),
        }
      );
      if (r.ok) break;
      lastErr = model + ': ' + (await r.text()).slice(0, 300);
      if (r.status !== 404 && r.status !== 400) break;
    }
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: 'Gemini error', status: r.status, detail: lastErr });

    const data = await r.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) return res.status(502).json({ error: 'No audio returned' });

    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const rate = Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000;

    // PCM 16-bit mono -> WAV
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(pcm.length, 40);

    res.setHeader('Content-Type', 'audio/wav');
    res.status(200).send(Buffer.concat([h, pcm]));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
