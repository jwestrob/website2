/* Layout wiring: collapsible header/panel, controls drawer, scroll pause */

export function initLayout({ viz } = {}){
  const header   = document.querySelector('.site-header');
  const panel    = document.querySelector('.hero-panel');
  const controls = document.getElementById('viz-controls');
  const sentinel = document.getElementById('hero-sentinel');

  const btnHeader   = document.getElementById('toggle-header');
  const btnPanel    = document.getElementById('toggle-panel');
  const btnOpenCtl  = document.getElementById('toggle-controls');
  const btnCloseCtl = document.getElementById('close-controls');

  if (!header || !panel || !controls) return;

  const setCollapsed = (el, collapsed) => {
    if (!el) return;
    el.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    if (el === controls){
      controls.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
      btnOpenCtl?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (!collapsed){
        const focusable = controls.querySelector('input, button, select, textarea');
        focusable?.focus({ preventScroll: true });
      } else {
        btnOpenCtl?.focus({ preventScroll: true });
      }
    }
  };

  btnHeader?.addEventListener('click', () => {
    const collapsed = header.getAttribute('data-collapsed') === 'true';
    const nextCollapsed = !collapsed;
    setCollapsed(header, nextCollapsed);
    header.setAttribute('data-collapsed', nextCollapsed ? 'true' : 'false');
    btnHeader.setAttribute('data-collapsed', nextCollapsed ? 'true' : 'false');
    btnHeader.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
  });

  btnPanel?.addEventListener('click', () => {
    const collapsed = panel.getAttribute('data-collapsed') === 'true';
    const nextCollapsed = !collapsed;
    setCollapsed(panel, nextCollapsed);
    btnPanel.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
  });

  btnOpenCtl?.addEventListener('click', () => {
    const collapsed = controls.getAttribute('data-collapsed') === 'true';
    setCollapsed(controls, !collapsed);
  });

  btnCloseCtl?.addEventListener('click', () => setCollapsed(controls, true));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (controls.getAttribute('data-collapsed') === 'false'){ setCollapsed(controls, true); return; }
    if (panel.getAttribute('data-collapsed') === 'false'){ setCollapsed(panel, true); }
  });

  if (panel){
    const getBoundary = () => {
      const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      if (sentinel){
        const rect = sentinel.getBoundingClientRect();
        return rect.top + scrollTop;
      }
      return window.innerHeight + scrollTop;
    };

    const updateClip = () => {
      const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      const headerHeight = header ? header.offsetHeight : 0;
      const panelHeight = Math.max(0, window.innerHeight - headerHeight);
      const boundary = getBoundary();
      const remaining = boundary - (scrollTop + headerHeight);
      const visible = Math.max(0, Math.min(panelHeight, remaining));
      const clipBottom = Math.max(0, panelHeight - visible);
      const hidden = visible <= 32;

      panel.style.setProperty('--hero-clip', `inset(0 -24px ${clipBottom}px 0)`);
      panel.setAttribute('data-outside', hidden ? 'true' : 'false');
      panel.setAttribute('aria-hidden', hidden ? 'true' : 'false');

      if (viz && typeof viz.pause === 'function' && typeof viz.resume === 'function'){
        if (hidden) viz.pause();
        else viz.resume();
      }
    };

    updateClip();
    window.addEventListener('scroll', updateClip, { passive: true });
    window.addEventListener('resize', updateClip);
  }
}
