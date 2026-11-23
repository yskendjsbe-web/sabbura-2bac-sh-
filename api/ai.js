// دالة الذكاء الاصطناعي: شرح مفصل لكل نقطة (explain) + جواب أسئلة التلميذ (ask)
const MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const SYS =
  'أنت أستاذ لغة عربية مغربي ودود لتلاميذ الثانية بكالوريا (آداب وعلوم إنسانية). ' +
  'تتكلم بعربية فصيحة سهلة وواضحة، بلا رموز ولا إيموجي ولا تنسيق ماركداون.';

async function gemini(key, prompt, asArray) {
  const generationConfig = { temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } };
  if (asArray) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = { type: 'ARRAY', items: { type: 'STRING' } };
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYS }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    }
  );
  if (!r.ok) throw new Error('Gemini ' + r.status);
  const d = await r.json();
  return (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  const b = req.body || {};

  try {
    if (b.action === 'explain') {
      const blocks = (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 12).map((x) => String(x).slice(0, 1500));
      if (!blocks.length) return res.status(400).json({ error: 'No blocks' });
      let prompt =
        `الدرس: ${String(b.lesson || '').slice(0, 200)}\nعنوان البطاقة: ${String(b.title || '').slice(0, 300)}\n\nالنقاط:\n` +
        blocks.map((t, i) => `${i + 1}) ${t}`).join('\n\n') +
        '\n\nاشرح كل نقطة شرحاً مفصلاً ودقيقاً كأنك تتحدث مع التلميذ أمامك: ابدأ بذكر اسم النقطة، فسّر كل جزء فيها ' +
        'مع مثال أو ربط بالنص عند الحاجة، ثم اختم بجملة تثبيت قصيرة. التزم بمضمون النقاط المعطاة ولا تخترع أسماء أو تواريخ ' +
        'أو أبياتاً جديدة. كل شرح بين 250 و650 حرفاً. أرجع مصفوفة JSON من النصوص بنفس عدد النقاط وبنفس الترتيب.';
      if (b.mode === 'simpler')
        prompt += '\nالتلميذ لم يفهم في المرة السابقة، فاشرح بكلمات أبسط وبمثال من الحياة اليومية، وبجمل أقصر.';
      let arr = [];
      try { arr = JSON.parse(await gemini(key, prompt, true)); } catch (e) { arr = []; }
      const explanations = blocks.map((t, i) => String(arr[i] || t).slice(0, 1100));
      return res.status(200).json({ explanations });
    }

    if (b.action === 'ask') {
      const q = String(b.question || '').slice(0, 500).trim();
      if (!q) return res.status(400).json({ error: 'No question' });
      const prompt =
        `الدرس: ${String(b.lesson || '').slice(0, 200)}\nما هو مكتوب الآن على السبورة:\n${String(b.context || '').slice(0, 4000)}\n\n` +
        `سؤال التلميذ: ${q}\n\nأجب بدقة وبوضوح في 300 إلى 650 حرفاً، معتمداً على ما في السبورة أولاً، ` +
        'وبمثال إن لزم. إن كان السؤال خارج مقرر اللغة العربية فاعتذر بلطف وأعده إلى الدرس.';
      const answer = (await gemini(key, prompt, false)).trim().slice(0, 1100);
      return res.status(200).json({ answer });
    }
    return res.status(400).json({ error: 'Bad action' });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
};
