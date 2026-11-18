/* Panel de administración */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const csrf = $('meta[name="csrf-token"]')?.content;
  const secureHeaders = (extra = {}) => (csrf ? { ...extra, 'x-csrf-token': csrf } : extra);

  function flashButton(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  /* Buscador de candidatos */
  const search = $('#cand-search');
  if (search) {
    const rows = $$('#cand-list .cand-row');
    const empty = $('#cand-empty');
    const count = $('#cand-count');
    search.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase();
      let visible = 0;
      rows.forEach((row) => {
        const match = !term || (row.dataset.search ?? '').includes(term);
        row.hidden = !match;
        if (match) visible += 1;
      });
      if (empty) empty.style.display = visible === 0 ? 'block' : 'none';
      if (count) count.textContent = `${visible} ${visible === 1 ? 'candidato' : 'candidatos'}`;
    });
  }

  /* Copiar links */
  $$('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.dataset.copy);
      flashButton(btn, ok ? 'Copiado' : 'No se pudo');
    });
  });

  /* Marcar como enviado al compartir por WhatsApp */
  $$('[data-mark-sent]').forEach((link) => {
    link.addEventListener('click', () => {
      fetch(link.dataset.markSent, {
        method: 'POST',
        headers: secureHeaders({ accept: 'application/json' }),
        keepalive: true,
      }).catch(() => {});
    });
  });

  /* Confirmaciones */
  $$('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });

  /* Selector de CV */
  const cvInput = $('#cv');
  if (cvInput) {
    cvInput.addEventListener('change', () => {
      const file = cvInput.files?.[0];
      const nameEl = $('#cv-name');
      if (!nameEl) return;
      if (!file) {
        nameEl.textContent = 'Elegir archivo';
        return;
      }
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      nameEl.textContent = `${file.name} · ${mb} MB`;
    });
  }

  /* Analizar CV al crear candidato */
  const analyzeForm = $('form[data-analyze]');
  if (analyzeForm) {
    analyzeForm.addEventListener('submit', () => {
      const btn = $('[data-analyze-submit]', analyzeForm);
      const note = $('[data-analyze-note]', analyzeForm);
      if (note) note.hidden = false;
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Leyendo el CV…';
      }
    });
  }

  /* Editor de resumen */
  const editor = $('[data-summary-editor]');
  if (editor) {
    const candidateId = editor.dataset.candidateId;
    const input = $('[data-summary-input]', editor);
    const preview = $('[data-summary-preview]', editor);
    const status = $('[data-summary-status]', editor);
    const errorEl = $('[data-summary-error]', editor);
    const btnSave = $('[data-summary-save]', editor);
    const btnGenerate = $('[data-summary-generate]', editor);
    const btnToggle = $('[data-summary-toggle]', editor);
    const endpoint = `/admin/api/candidatos/${candidateId}/resumen`;

    const setStatus = (text) => {
      if (status) status.textContent = text;
    };
    const showError = (message) => {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = !message;
    };

    const renderSummary = (text) => {
      const lines = String(text || '').split(/\r?\n/);
      let html = '';
      let inList = false;
      const close = () => {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
      };
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) {
          close();
          continue;
        }
        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (/^[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{2,40}:$/.test(line)) {
          close();
          html += `<h3>${escaped.replace(/:$/, '')}</h3>`;
        } else if (/^[•\-*]\s+/.test(line)) {
          if (!inList) {
            html += '<ul>';
            inList = true;
          }
          html += `<li>${escaped.replace(/^[•\-*]\s*/, '')}</li>`;
        } else {
          close();
          html += `<p>${escaped}</p>`;
        }
      }
      close();
      return html;
    };

    input?.addEventListener('input', () => setStatus('Cambios sin guardar'));

    btnToggle?.addEventListener('click', () => {
      const isHidden = preview.hasAttribute('hidden');
      if (isHidden) preview.innerHTML = renderSummary(input.value);
      preview.toggleAttribute('hidden', !isHidden);
      btnToggle.textContent = isHidden ? 'Ocultar vista previa' : 'Ver vista previa';
    });

    btnSave?.addEventListener('click', async () => {
      showError('');
      btnSave.disabled = true;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: secureHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ summary: input.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar.');
        setStatus('Guardado');
        if (!preview.hasAttribute('hidden')) preview.innerHTML = renderSummary(input.value);
      } catch (err) {
        showError(err.message);
      } finally {
        btnSave.disabled = false;
      }
    });

    btnGenerate?.addEventListener('click', async () => {
      showError('');
      if (input.value.trim() && !window.confirm('Se va a reemplazar el resumen actual por uno generado con IA. ¿Seguir?')) return;
      btnGenerate.disabled = true;
      const original = btnGenerate.textContent;
      btnGenerate.textContent = 'Generando…';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: secureHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo generar el resumen.');
        input.value = data.summary;
        setStatus(`Generado con ${data.provider || 'IA'}`);
        if (!preview.hasAttribute('hidden')) preview.innerHTML = renderSummary(data.summary);
      } catch (err) {
        showError(err.message);
      } finally {
        btnGenerate.disabled = false;
        btnGenerate.textContent = original;
      }
    });
  }
})();
