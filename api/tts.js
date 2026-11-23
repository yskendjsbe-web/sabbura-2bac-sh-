module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

  const { question, lessonTitle, stepContext } = req.body || {};
  const q = String(question || '').trim();
  if (!q || q.length > 800) return res.status(400).json({ error: 'Invalid question' });

  const model = process.env.GEMINI_ASK_MODEL || 'gemini-2.5-flash';

  const systemPrompt = `أنت أستاذ لغة عربية مغربي خبير في مراجعة الثانية باكالوريا (آداب وعلوم إنسانية).
اشرح للتلميذ بوضوح ودقة ومنهجية مبسطة باللغة العربية الفصحى الميسرة.
الدرس الحالي: ${lessonTitle || 'إحياء النموذج'}
النقطة المشروحة حالياً: ${stepContext || ''}
إذا كان التلميذ يمدح أو يكتب كلاماً عابراً، شجعه بإيجاز واسأله إن كان يريد تفصيلاً أو الانتقال.
في نهاية جوابك، اسأله بلطف: هل اتضحت الفكرة أم نعاود توضيح نقطة معينة قبل الانتقال؟`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${systemPrompt}\n\nسؤال/ملاحظة التلميذ: ${q}` }] }
          ],
          generationConfig: { temperature: 0.4, maxOutputTokens: 700 }
        })
      }
    );

    if (!r.ok) {
      return res.status(502).json({ error: 'Gemini error', status: r.status });
    }

    const data = await r.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'لم أتمكن من صياغة الجواب، حاول مرة أخرى.';
    res.status(200).json({ answer });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
