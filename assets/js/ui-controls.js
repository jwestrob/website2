/* Visualization controls drawer bindings */

export function initControls({ viz } = {}){
  const instance = viz ?? window.__viz;
  if (!instance){
    console.warn('Visualization controls: no active visualizer instance.');
    return;
  }

  const getState = () => (typeof instance.getState === 'function' ? instance.getState() : {});

  const seqField = document.getElementById('ctl-sequence');
  const statusEl = document.getElementById('ctl-status');
  const telemetryEl = document.getElementById('ctl-telemetry');
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  const setRangeValue = (id, value) => {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    el.value = String(value);
  };

  const setCheckValue = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = Boolean(value);
  };

  const formatSequence = (seq) => (seq || '').replace(/[^A-Za-z]/g, '').toUpperCase().replace(/(.{60})/g, '$1\n');

  const syncControls = ({ includeSequence = false } = {}) => {
    const state = getState();
    if (!state) return;

    setRangeValue('ctl-slice', state.slice);
    setRangeValue('ctl-fold', state.fold);
    setRangeValue('ctl-iters', state.iterations);
    setRangeValue('ctl-bloom', state.bloom);
    setRangeValue('ctl-exposure', state.exposure);
    setRangeValue('ctl-rough', state.roughness);
    setRangeValue('ctl-slice-amp', state.sliceAmplitude);
    setRangeValue('ctl-slice-speed', state.sliceSpeed);
    setRangeValue('ctl-rotate-speed', state.rotationSpeed);
    setRangeValue('ctl-cloop-scale', state.cLoopScale);
    setRangeValue('ctl-cloop-speed', state.cLoopSpeed);

    setCheckValue('ctl-anim-slice', state.animateSlice);
    setCheckValue('ctl-anim-rotate', state.animateRotation);
    setCheckValue('ctl-anim-cloop', state.animateCLoop);

    if (includeSequence && seqField){
      seqField.value = formatSequence(state.sequence);
    }

    if (telemetryEl){
      const lines = [
        `Sequence  : ${state.sequence ? `${state.sequence.length.toLocaleString()} bp/aa` : 'none'}`,
        `Slice w   : ${Number(state.slice ?? 0).toFixed(3)}`,
        `Iterations: ${state.iterations ?? 'n/a'}`,
        `Fold      : ${(state.fold ?? 0).toFixed(2)}`,
        `Bloom     : ${(state.bloom ?? 0).toFixed(2)}  Exposure: ${(state.exposure ?? 0).toFixed(2)}`,
        `Roughness : ${(state.roughness ?? 0).toFixed(2)}`,
        `Animation : slice=${state.animateSlice ? 'on ' : 'off'} rot=${state.animateRotation ? 'on ' : 'off'} c-loop=${state.animateCLoop ? 'on' : 'off'}`,
        `Speeds    : slice=${(state.sliceSpeed ?? 0).toFixed(3)} rot=${(state.rotationSpeed ?? 0).toFixed(3)} loop=${(state.cLoopSpeed ?? 0).toFixed(3)}`,
      ];
      telemetryEl.textContent = lines.join('\n');
    }
  };

  const bindRange = (id, key, transform = (v) => v) => {
    const el = document.getElementById(id);
    if (!el) return;
    const handler = () => {
      const value = transform(parseFloat(el.value));
      if (Number.isNaN(value)) return;
      instance.setParams({ [key]: value });
      syncControls();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  };

  const bindCheck = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    const handler = () => {
      instance.setParams({ [key]: el.checked });
      syncControls();
    };
    el.addEventListener('change', handler);
  };

  bindCheck('ctl-anim-slice', 'animateSlice');
  bindCheck('ctl-anim-rotate', 'animateRotation');
  bindCheck('ctl-anim-cloop',  'animateCLoop');

  bindRange('ctl-bloom',        'bloom');
  bindRange('ctl-exposure',     'exposure');
  bindRange('ctl-rough',        'roughness');
  bindRange('ctl-slice',        'slice');
  bindRange('ctl-fold',         'fold');
  bindRange('ctl-iters',        'iterations', (v) => Math.round(v));
  bindRange('ctl-slice-amp',    'sliceAmplitude');
  bindRange('ctl-slice-speed',  'sliceSpeed');
  bindRange('ctl-rotate-speed', 'rotationSpeed');
  bindRange('ctl-cloop-scale',  'cLoopScale');
  bindRange('ctl-cloop-speed',  'cLoopSpeed');

  const applyBtn = document.getElementById('ctl-apply-sequence');
  if (applyBtn && seqField){
    applyBtn.addEventListener('click', () => {
      const raw = seqField.value.trim();
      if (!raw){
        setStatus('Enter a DNA or protein sequence first.');
        return;
      }
      const cleaned = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (!cleaned){
        setStatus('No valid characters found; expected ACGT… or amino acids.');
        return;
      }
      const ok = instance.setSequence(cleaned);
      if (ok){
        seqField.value = formatSequence(cleaned);
        setStatus(`Sequence applied (${cleaned.length.toLocaleString()} chars).`);
        syncControls();
      } else {
        setStatus('Sequence did not map — please check the alphabet.');
      }
    });
  }

  const centerBtn = document.getElementById('ctl-center');
  if (centerBtn){
    centerBtn.addEventListener('click', () => {
      const centroid = instance.recenter?.();
      if (centroid){
        setStatus('Centered on current slice.');
      } else {
        setStatus('Centering failed — try a different view.');
      }
    });
  }

  const docsToggle = document.getElementById('ctl-docs-toggle');
  const docsContent = document.getElementById('ctl-docs-content');
  if (docsToggle && docsContent){
    docsToggle.addEventListener('click', (event) => {
      event.preventDefault();
      const expanded = docsToggle.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      docsToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      docsToggle.classList.toggle('is-open', next);
      docsContent.hidden = !next;
      docsContent.style.display = next ? 'grid' : 'none';
    });
    docsContent.style.display = docsContent.hidden ? 'none' : 'grid';
  }

  syncControls();
  setStatus('Ready. Paste a sequence or adjust parameters.');
}
