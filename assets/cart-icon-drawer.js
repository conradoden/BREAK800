(function () {
  function getDrawer() {
    return document.querySelector('cart-drawer');
  }

  function unlockBody() {
    if (document.body) document.body.classList.remove('overflow-hidden');
    if (document.documentElement) document.documentElement.classList.remove('cart-drawer-open');
  }

  function watchDrawerForClose() {
    const drawer = getDrawer();
    if (!drawer || drawer.__bkCloseWatched) return;
    drawer.__bkCloseWatched = true;

    const observer = new MutationObserver(function () {
      if (!drawer.classList.contains('active')) {
        setTimeout(unlockBody, 50);
      }
    });
    observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });
  }

  function bind() {
    if (window.__bkCartIconOpensDrawer) return;
    window.__bkCartIconOpensDrawer = true;

    document.addEventListener(
      'click',
      function (e) {
        const link = e.target.closest && e.target.closest('a.header__icon--cart');
        if (!link || e.defaultPrevented) return;
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

        const href = (link.getAttribute('href') || '').toLowerCase();
        if (href.indexOf('/cart') === -1) return;

        const drawer = getDrawer();
        if (!drawer || typeof drawer.open !== 'function') return;

        e.preventDefault();
        e.stopPropagation();
        watchDrawerForClose();
        try {
          drawer.open(link);
        } catch (_) {
          try { drawer.open(); } catch (__) {}
        }
      },
      true
    );

    document.addEventListener(
      'click',
      function (e) {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.drawer__close, #CartDrawer-Overlay, .cart-drawer__overlay')) {
          setTimeout(unlockBody, 350);
        }
      },
      true
    );

    if (getDrawer()) watchDrawerForClose();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
