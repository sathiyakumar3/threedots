// ── AI Assist (Chrome built-in Summarizer API) ────────────────────────────
(function () {
  let titleEl, textEl, titleBtn, descBtn;
  let aiAvailable = false;

  // ── Chrome Summarizer ─────────────────────────────────────────────────────
  async function checkSummarizerAvailable() {
    if (!('Summarizer' in self)) return false;
    return (await Summarizer.availability()) !== 'unavailable';
  }

  async function createSummarizer(options) {
    return Summarizer.create({
      ...options,
      monitor(m) {
        m.addEventListener('downloadprogress', e =>
          console.log(`[AI] Downloading model: ${Math.round(e.loaded * 100)}%`)
        );
      },
    });
  }

  // ── Visibility ────────────────────────────────────────────────────────────
  function wordCount(str) {
    return (str || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function updateVisibility() {
    if (!aiAvailable) {
      titleBtn?.classList.remove('ai-assist-btn--visible');
      descBtn?.classList.remove('ai-assist-btn--visible');
      return;
    }
    const hasTitle  = wordCount(titleEl?.value) >= 1;
    const descWords = wordCount(textEl?.value);
    const descLong  = descWords > 3;
    titleBtn?.classList.toggle('ai-assist-btn--visible', hasTitle || descLong);
    descBtn?.classList.toggle('ai-assist-btn--visible', descLong);
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector('i').className = loading ? 'fas fa-spinner fa-spin' : 'fas fa-magic';
    if (loading) btn.classList.add('ai-assist-btn--visible');
  }

  // ── Strip label prefixes and surrounding quotes from output ───────────────
  function clean(str) {
    return str
      .replace(/^(headline|summary|tldr|title|result)\s*:\s*/i, '')
      .replace(/^["'"']+|["'"']+$/g, '')
      .trim();
  }

  // ── Shared runner ─────────────────────────────────────────────────────────
  async function runAI(btn, getSummarizer, getInput, onResult) {
    if (!aiAvailable) {
      showToast('Chrome Summarizer API is not available in this browser.', true);
      return;
    }
    setLoading(btn, true);
    try {
      const summarizer = await getSummarizer();
      const result = clean((await summarizer.summarize(getInput())).trim());
      summarizer.destroy();
      if (result) onResult(result);
    } catch (err) {
      console.error('[AI]', err);
      showToast('AI generation failed.', true);
    } finally {
      setLoading(btn, false);
      updateVisibility();
    }
  }

  // ── Title: generate headline ──────────────────────────────────────────────
  function generateHeadline() {
    const title = titleEl.value.trim();
    const text  = textEl.value.trim();
    if (!title && !text) return;
    runAI(
      titleBtn,
      () => createSummarizer({ type: 'headline', format: 'plain-text', length: 'short' }),
      () => [title && `Title: ${title}`, text && `Description: ${text}`].filter(Boolean).join('\n'),
      result => { titleEl.value = result; titleEl.dispatchEvent(new Event('input')); }
    );
  }

  // ── Description: generate TL;DR ──────────────────────────────────────────
  function generateSummary() {
    const title = titleEl.value.trim();
    const text  = textEl.value.trim();
    if (!text) return;
    runAI(
      descBtn,
      () => createSummarizer({ type: 'tldr', format: 'plain-text', length: 'medium',
                               sharedContext: title ? `Card title: ${title}` : undefined }),
      () => text,
      result => { textEl.value = result; textEl.dispatchEvent(new Event('input')); }
    );
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    titleEl  = document.getElementById('cardTitle');
    textEl   = document.getElementById('cardText');
    titleBtn = document.getElementById('aiTitleBtn');
    descBtn  = document.getElementById('aiDescBtn');
    if (!titleEl || !textEl || !titleBtn || !descBtn) return;

    titleEl.addEventListener('input', updateVisibility);
    textEl.addEventListener('input', updateVisibility);
    titleBtn.addEventListener('click', e => { e.stopPropagation(); generateHeadline(); });
    descBtn.addEventListener('click',  e => { e.stopPropagation(); generateSummary();  });
    updateVisibility();
  }

  document.addEventListener('DOMContentLoaded', () => {
    checkSummarizerAvailable().then(available => {
      aiAvailable = available;
      console.log('[AI] Chrome Summarizer available:', aiAvailable);
      init();
      setupModalObserver();
    });
  });

  function setupModalObserver() {
    new MutationObserver(() => {
      if (!document.getElementById('modalOverlay')?.classList.contains('open'))
        updateVisibility();
    }).observe(document.getElementById('modalOverlay') || document.body,
               { attributes: true, attributeFilter: ['class'] });

    setTimeout(() => {
      ['_openModal', '_openEditModal'].forEach(key => {
        const orig = window[key];
        if (orig) window[key] = function (...args) { orig.apply(this, args); setTimeout(updateVisibility, 0); };
      });
    }, 100);
  }
}());

//
// To enable Gemini: set window.GEMINI_API_KEY before this script runs.
// e.g. in firebase-init.js: window.GEMINI_API_KEY = 'YOUR_KEY_HERE';
// Get a free key at https://aistudio.google.com/app/apikey
(function () {
  let titleEl, textEl, titleBtn, descBtn;
  let aiAvailable = false;

  // ── Gemini API ────────────────────────────────────────────────────────────
  // Model preference order: try 2.0-flash first, fall back to 1.5-flash
  const GEMINI_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];
  const GEMINI_BASE =
    'https://generativelanguage.googleapis.com/v1beta/models/';

  async function callGemini(prompt) {
    const key = window.GEMINI_API_KEY;
    if (!key || key === 'YOUR_GEMINI_API_KEY') throw new Error('Gemini API key not set.');

    let lastErr;
    for (const model of GEMINI_MODELS) {
      const res = await fetch(`${GEMINI_BASE}${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 256 }
        })
      });

      if (res.ok) {
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      }

      const errBody = await res.json().catch(() => ({}));
      const msg = errBody?.error?.message || `HTTP ${res.status}`;

      // 429 = quota / rate-limit → try next model
      if (res.status === 429) {
        console.warn(`[AI] ${model} quota exceeded, trying next model…`);
        lastErr = new Error(`Quota exceeded (${model}). ${msg}`);
        continue;
      }

      // Any other error is terminal
      throw new Error(msg);
    }

    // All models exhausted
    throw new Error('AI quota exceeded for all available models. Please try again later or upgrade your Gemini plan.');
  }

  // ── Chrome Summarizer fallback ────────────────────────────────────────────
  async function checkSummarizerAvailable() {
    if (!('Summarizer' in self)) return false;
    return (await Summarizer.availability()) !== 'unavailable';
  }

  async function createSummarizer(options) {
    return Summarizer.create({
      ...options,
      monitor(m) {
        m.addEventListener('downloadprogress', e =>
          console.log(`[AI] Downloading model: ${Math.round(e.loaded * 100)}%`)
        );
      },
    });
  }

  // ── Visibility ────────────────────────────────────────────────────────────
  function wordCount(str) {
    return (str || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function updateVisibility() {
    if (!aiAvailable) {
      titleBtn?.classList.remove('ai-assist-btn--visible');
      descBtn?.classList.remove('ai-assist-btn--visible');
      return;
    }
    const hasTitle  = wordCount(titleEl?.value) >= 1;
    const descWords = wordCount(textEl?.value);
    const descLong  = descWords > 3;
    titleBtn?.classList.toggle('ai-assist-btn--visible', hasTitle || descLong);
    descBtn?.classList.toggle('ai-assist-btn--visible', descLong);
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector('i').className = loading ? 'fas fa-spinner fa-spin' : 'fas fa-magic';
    if (loading) btn.classList.add('ai-assist-btn--visible');
  }

  // ── Strip label prefixes and surrounding quotes from output ───────────────
  function clean(str) {
    return str
      .replace(/^(headline|summary|tldr|title|result)\s*:\s*/i, '')
      .replace(/^["'"']+|["'"']+$/g, '')
      .trim();
  }

  // ── Unified runner: tries Gemini first, falls back to Chrome Summarizer ───
  async function runAI(btn, geminiPrompt, getChromeInput, getChromeOptions, onResult) {
    setLoading(btn, true);
    try {
      let result = '';
      const hasGemini = window.GEMINI_API_KEY && window.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY';
      if (hasGemini) {
        result = clean(await callGemini(geminiPrompt));
      } else {
        // Chrome Summarizer fallback
        const summarizer = await createSummarizer(getChromeOptions());
        result = clean((await summarizer.summarize(getChromeInput())).trim());
        summarizer.destroy();
      }
      if (result) onResult(result);
    } catch (err) {
      console.error('[AI]', err);
      const isQuota = err.message?.toLowerCase().includes('quota');
      showToast(isQuota ? 'AI quota exceeded — try again later.' : 'AI generation failed.', true);
    } finally {
      setLoading(btn, false);
      updateVisibility();
    }
  }

  // ── Title: generate headline ──────────────────────────────────────────────
  function generateHeadline() {
    const title = titleEl.value.trim();
    const text  = textEl.value.trim();
    if (!title && !text) return;
    const geminiPrompt =
      `Generate a short, clear task headline (max 8 words, no quotes, no label prefix) for a Kanban card.\n` +
      (title ? `Current title: ${title}\n` : '') +
      (text  ? `Description: ${text}\n`    : '') +
      `Reply with only the headline text.`;
    runAI(
      titleBtn,
      geminiPrompt,
      () => [title && `Title: ${title}`, text && `Description: ${text}`].filter(Boolean).join('\n'),
      () => ({ type: 'headline', format: 'plain-text', length: 'short' }),
      result => { titleEl.value = result; titleEl.dispatchEvent(new Event('input')); }
    );
  }

  // ── Description: generate TL;DR ──────────────────────────────────────────
  function generateSummary() {
    const title = titleEl.value.trim();
    const text  = textEl.value.trim();
    if (!text) return;
    const geminiPrompt =
      `Summarize the following task description in 1-2 sentences. Be concise and direct. No label prefix, no quotes.\n` +
      (title ? `Task title: ${title}\n` : '') +
      `Description: ${text}\n` +
      `Reply with only the summary.`;
    runAI(
      descBtn,
      geminiPrompt,
      () => text,
      () => ({ type: 'tldr', format: 'plain-text', length: 'medium',
               sharedContext: title ? `Card title: ${title}` : undefined }),
      result => { textEl.value = result; textEl.dispatchEvent(new Event('input')); }
    );
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    titleEl  = document.getElementById('cardTitle');
    textEl   = document.getElementById('cardText');
    titleBtn = document.getElementById('aiTitleBtn');
    descBtn  = document.getElementById('aiDescBtn');
    if (!titleEl || !textEl || !titleBtn || !descBtn) return;

    titleEl.addEventListener('input', updateVisibility);
    textEl.addEventListener('input', updateVisibility);
    titleBtn.addEventListener('click', e => { e.stopPropagation(); generateHeadline(); });
    descBtn.addEventListener('click',  e => { e.stopPropagation(); generateSummary();  });
    updateVisibility();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const hasGemini = window.GEMINI_API_KEY && window.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY';
    if (hasGemini) {
      aiAvailable = true;
      console.log('[AI] Using Gemini API');
      init();
      setupModalObserver();
    } else {
      // Fall back to Chrome Summarizer
      checkSummarizerAvailable().then(available => {
        aiAvailable = available;
        console.log('[AI] Chrome Summarizer available:', aiAvailable);
        init();
        setupModalObserver();
      });
    }
  });

  function setupModalObserver() {
    new MutationObserver(() => {
      if (!document.getElementById('modalOverlay')?.classList.contains('open'))
        updateVisibility();
    }).observe(document.getElementById('modalOverlay') || document.body,
               { attributes: true, attributeFilter: ['class'] });

    setTimeout(() => {
      ['_openModal', '_openEditModal'].forEach(key => {
        const orig = window[key];
        if (orig) window[key] = function (...args) { orig.apply(this, args); setTimeout(updateVisibility, 0); };
      });
    }, 100);
  }
}());


