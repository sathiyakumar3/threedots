// ── AI Assist (Chrome built-in Summarizer API) ────────────────────────────
(function () {
  // Resolved once in init()
  let titleEl, textEl, titleBtn, descBtn;
  let aiAvailable = false; // checked eagerly on startup

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
    const hasTitle   = wordCount(titleEl?.value) >= 1;
    const descWords  = wordCount(textEl?.value);
    const descLong   = descWords > 3;
    titleBtn?.classList.toggle('ai-assist-btn--visible', hasTitle || descLong);
    descBtn?.classList.toggle('ai-assist-btn--visible', descLong);
  }

  // ── Summarizer helpers ────────────────────────────────────────────────────
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

  // ── Strip label prefixes and surrounding quotes from API output ──────────
  function clean(str) {
    return str
      .replace(/^(headline|summary|tldr|title|result)\s*:\s*/i, '') // remove label prefix
      .replace(/^["'"']+|["'"']+$/g, '')                            // strip surrounding quotes
      .trim();
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector('i').className = loading ? 'fas fa-spinner fa-spin' : 'fas fa-magic';
    if (loading) btn.classList.add('ai-assist-btn--visible');
  }

  // ── Shared AI runner ──────────────────────────────────────────────────────
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

  // ── Description: generate summary ────────────────────────────────────────
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
    // ── Check availability eagerly on startup; only wire up buttons if available ──
    checkSummarizerAvailable().then(available => {
      aiAvailable = available;
      console.log('[AI] Summarizer available:', aiAvailable);
      init();

      // Hide buttons when modal closes (values reset without firing 'input')
      new MutationObserver(() => {
        if (!document.getElementById('modalOverlay')?.classList.contains('open'))
          updateVisibility();
      }).observe(document.getElementById('modalOverlay') || document.body,
                 { attributes: true, attributeFilter: ['class'] });

      // Patch modal openers to re-check visibility after fields are populated
      setTimeout(() => {
        ['_openModal', '_openEditModal'].forEach(key => {
          const orig = window[key];
          if (orig) window[key] = function (...args) { orig.apply(this, args); setTimeout(updateVisibility, 0); };
        });
      }, 100);
    });
  });
}());

