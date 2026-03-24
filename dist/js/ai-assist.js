(function () {
  let titleEl, textEl, titleBtn, descBtn;
  let aiAvailable = false;

  // ── Chrome built-in Summarizer (browser AI) ───────────────────────────────
  async function checkSummarizerAvailable() {
    if (!('Summarizer' in self)) return false;
    const lang = (navigator.language || 'en').split('-')[0];
    return (await Summarizer.availability({ outputLanguage: lang })) !== 'unavailable';
  }

  async function createSummarizer(options) {
    return Summarizer.create({
      outputLanguage: (navigator.language || 'en').split('-')[0],
      ...options,
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

  // ── Unified runner: uses Chrome built-in Summarizer ─────────────────────
  async function runAI(btn, _geminiPrompt, getChromeInput, getChromeOptions, onResult) {
    setLoading(btn, true);
    try {
      const summarizer = await createSummarizer(getChromeOptions());
      const result = clean((await summarizer.summarize(getChromeInput())).trim());
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
    checkSummarizerAvailable().then(available => {
      aiAvailable = available;
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


