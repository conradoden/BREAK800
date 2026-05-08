(function () {
  const TARGET_URL = '/products/birch-chaga-cacao-truffles';

  const SKIP_CONTAINERS = [
    'header',
    'footer',
    '.section-header',
    '.section-footer',
    '.shopify-section-header-group',
    '.shopify-section-footer-group',
    'cart-drawer',
    'cart-notification',
    'main-cart-items',
    'main-cart-footer',
    '.cart__contents',
    '.cart-drawer__form',
    '.modal',
    '.modal__content',
    '.popup-modal',
    'predictive-search',
    '.search-modal',
    'search-form',
    'product-form',
    '.product-form',
    '.shopify-payment-button',
    '.localization-form',
    '.password-modal',
    'details-modal',
    '.menu-drawer',
    '.country-selector',
    '.language-selector'
  ].join(',');

  const SKIP_HREF_PREFIXES = [
    '/cart',
    '/checkout',
    '/account',
    '/login',
    '/logout',
    '/register',
    '/search',
    '/contact',
    '/policies'
  ];

  function shouldSkip(link) {
    const hrefAttr = link.getAttribute('href');
    if (!hrefAttr) return true;
    const href = hrefAttr.trim();
    if (
      !href ||
      href.charAt(0) === '#' ||
      href.indexOf('javascript:') === 0 ||
      href.indexOf('mailto:') === 0 ||
      href.indexOf('tel:') === 0
    ) {
      return true;
    }

    const lower = href.toLowerCase();
    if (lower.indexOf(TARGET_URL) !== -1) return true;

    let path = lower;
    try {
      path = new URL(href, window.location.origin).pathname;
    } catch (_) {}

    for (let i = 0; i < SKIP_HREF_PREFIXES.length; i++) {
      const p = SKIP_HREF_PREFIXES[i];
      if (path === p || path.indexOf(p + '/') === 0 || path.indexOf(p + '?') === 0) {
        return true;
      }
    }

    if (link.closest(SKIP_CONTAINERS)) return true;
    if (link.hasAttribute('data-no-cta-retarget')) return true;

    return false;
  }

  function retarget(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const links = root.querySelectorAll('a.button, a.btn, a.button--primary, a.button--secondary');
    links.forEach(function (link) {
      if (shouldSkip(link)) return;
      link.setAttribute('href', TARGET_URL);
      link.setAttribute('data-cta-retargeted', 'true');
      link.removeAttribute('target');
    });
  }

  function init() {
    retarget(document);

    if (window.Shopify && Shopify.designMode) {
      document.addEventListener('shopify:section:load', function (e) {
        retarget(e.target);
      });
      document.addEventListener('shopify:section:reorder', function () {
        retarget(document);
      });
      document.addEventListener('shopify:block:select', function (e) {
        retarget(e.target);
      });
    }

    const observer = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type !== 'childList') continue;
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          retarget(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
