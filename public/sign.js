/* Vista de firma del directorio */
(() => {
  const cfg = window.__SIGN__ || {};

  /* Pestañas */
  const tabs = Array.from(document.querySelectorAll('[data-tab]'));
  const panels = {
    caratula: document.getElementById('panel-caratula'),
    cv: document.getElementById('panel-cv'),
    informe: document.getElementById('panel-informe'),
    resumen: document.getElementById('panel-resumen'),
  };

  function activate(name, scroll = false) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
    });
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.hidden = key !== name;
    });
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => activate(tab.dataset.tab, true)));
  if (window.location.hash === '#caratula') activate('caratula');

  /* Rechazo del candidato (sólo Directorio) */
  const rejectModal = document.getElementById('reject-modal');
  const openReject = document.getElementById('open-reject');
  if (rejectModal && openReject) {
    const rejectReason = document.getElementById('reject-reason');
    const rejectError = document.getElementById('reject-error');
    const confirmReject = document.getElementById('confirm-reject');
    const rejectFormView = document.getElementById('reject-form-view');
    const rejectSuccess = document.getElementById('reject-success');
    let rejecting = false;

    const showRejectError = (message) => {
      if (!rejectError) return;
      rejectError.textContent = message || '';
      rejectError.classList.toggle('is-visible', Boolean(message));
    };

    const openRejectModal = () => {
      rejectModal.hidden = false;
      rejectModal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      showRejectError('');
      requestAnimationFrame(() => rejectReason?.focus({ preventScroll: true }));
    };

    const closeRejectModal = () => {
      if (rejecting) return;
      rejectModal.classList.remove('is-open');
      rejectModal.hidden = true;
      document.body.style.overflow = '';
      openReject.focus({ preventScroll: true });
    };

    openReject.addEventListener('click', openRejectModal);
    rejectModal.querySelectorAll('[data-close-reject]').forEach((el) => el.addEventListener('click', closeRejectModal));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !rejectModal.hidden) closeRejectModal();
    });
    rejectReason?.addEventListener('input', () => showRejectError(''));

    confirmReject?.addEventListener('click', async () => {
      if (rejecting) return;
      const reason = (rejectReason?.value || '').trim();
      if (reason.length < 5) {
        showRejectError('Escribí el motivo del rechazo (al menos 5 caracteres).');
        rejectReason?.focus();
        return;
      }
      rejecting = true;
      const original = confirmReject.textContent;
      confirmReject.disabled = true;
      confirmReject.textContent = 'Rechazando…';
      try {
        const res = await fetch(cfg.rejectEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ reason }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo registrar el rechazo.');
        if (rejectFormView) rejectFormView.hidden = true;
        if (rejectSuccess) rejectSuccess.hidden = false;
        rejectModal.querySelector('.modal__sheet')?.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => window.location.reload(), 2600);
      } catch (err) {
        showRejectError(err.message || 'No se pudo registrar el rechazo. Probá de nuevo.');
        confirmReject.disabled = false;
        confirmReject.textContent = original;
        rejecting = false;
      }
    });
  }

  if (cfg.signed) return;

  /* Modal de firma */
  const modal = document.getElementById('sign-modal');
  const openBtn = document.getElementById('open-sign');
  if (!modal || !openBtn) return;

  const canvas = document.getElementById('sig-canvas');
  const wrap = document.getElementById('sig-wrap');
  const clearBtn = document.getElementById('clear-sign');
  const confirmBtn = document.getElementById('confirm-sign');
  const consent = document.getElementById('consent');
  const errorEl = document.getElementById('sign-error');
  const formView = document.getElementById('sign-form-view');
  const successView = document.getElementById('sign-success');
  const successHash = document.getElementById('success-hash');

  let pad = null;
  let lastFocus = null;
  let submitting = false;

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.classList.toggle('is-visible', Boolean(message));
  }

  function sizeCanvas() {
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
  }

  function initPad() {
    if (pad) {
      sizeCanvas();
      pad.clear();
      wrap?.classList.remove('is-signed');
      return;
    }
    sizeCanvas();
    if (typeof window.SignaturePad !== 'function') {
      showError('No se pudo cargar el área de firma. Recargá la página e intentá de nuevo.');
      return;
    }
    pad = new window.SignaturePad(canvas, {
      backgroundColor: 'rgba(255,255,255,0)',
      penColor: '#101c22',
      minWidth: 0.8,
      maxWidth: 2.6,
      throttle: 8,
    });
    pad.addEventListener('beginStroke', () => wrap?.classList.add('is-signed'));
  }

  function openModal() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    showError('');
    requestAnimationFrame(() => {
      initPad();
      modal.querySelector('.modal__close')?.focus({ preventScroll: true });
    });
  }

  function closeModal() {
    if (submitting) return;
    modal.classList.remove('is-open');
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
  }

  openBtn.addEventListener('click', openModal);
  modal.querySelectorAll('[data-close-sign]').forEach((el) => el.addEventListener('click', closeModal));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  // Al rotar o redimensionar, redibujar el canvas (se limpia la firma).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (modal.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (pad && !pad.isEmpty()) {
        const was = pad.toData();
        sizeCanvas();
        pad.clear();
        pad.fromData(was);
      } else {
        initPad();
      }
    }, 200);
  });

  clearBtn?.addEventListener('click', () => {
    pad?.clear();
    wrap?.classList.remove('is-signed');
    showError('');
  });

  consent?.addEventListener('change', () => showError(''));

  confirmBtn?.addEventListener('click', async () => {
    if (submitting) return;
    showError('');

    if (!pad || pad.isEmpty()) {
      showError('Dibujá tu firma antes de confirmar.');
      return;
    }
    const dniInput = document.getElementById('signer-dni');
    let dni = dniInput ? dniInput.value.replace(/\D/g, '').trim() : '';
    if (!dni) {
      showError('Ingresá tu número de DNI para validar la firma.');
      dniInput?.focus();
      return;
    }
    if (dni.length !== 8) {
      showError('El DNI debe tener exactamente 8 dígitos numéricos.');
      dniInput?.focus();
      return;
    }
    if (dniInput) dniInput.value = dni;
    if (!consent?.checked) {
      showError('Marcá la declaración para poder firmar.');
      return;
    }

    submitting = true;
    const original = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Firmando…';

    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          signature: pad.toDataURL('image/png'),
          accepted: true,
          dni,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar la firma.');

      formView.hidden = true;
      successView.hidden = false;
      if (successHash && (data.signatureHash || data.hash)) {
        successHash.textContent = `Código de firma SHA-256 ${data.signatureHash || data.hash}`;
      }
      modal.querySelector('.modal__sheet')?.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => window.location.reload(), 4000);
    } catch (err) {
      showError(err.message || 'No se pudo registrar la firma. Probá de nuevo.');
      confirmBtn.disabled = false;
      confirmBtn.textContent = original;
      submitting = false;
    }
  });
})();
