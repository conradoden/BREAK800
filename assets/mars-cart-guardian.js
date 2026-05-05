/* =====================================================================
   mars-cart-guardian.js
   ---------------------------------------------------------------------
   Loaded SYNCHRONOUSLY before any other script in <head> so its
   interceptors are installed on `window.fetch` and `XMLHttpRequest`
   before the BREAK remote bundle (or any other code) can capture
   the originals.

   Enforces, on every cart write from any source, with no page reloads:

     1. Free-gift line items always have quantity = 1. If anything
        increases a gift's quantity, we silently force it back.
     2. Gift lines are removed automatically when their associated
        main product line is removed from the cart. Each gift carries
        the property `_main_variant: '<variant id>'` set by
        mars-product-form.js when the bundle is added.

   Reconciliation is atomic: a single `/cart/update.js` call adjusts
   all problematic line items at once. After the cart write we
   re-fetch the cart-drawer and cart-icon-bubble sections and patch
   their HTML into the DOM in place — no page reload. The
   custom-element children inside the drawer (cart-drawer-items,
   cart-remove-button, etc.) re-upgrade automatically when their HTML
   is re-inserted.

   The guardian uses an `X-Mars-Guardian` header on its own writes so
   it never recurses on itself.
===================================================================== */
(function () {
  if (window.__marsCartGuardianInstalled) return;
  window.__marsCartGuardianInstalled = true;

  const FREE_GIFT_PROP = '_free_gift';
  const MAIN_VARIANT_PROP = '_main_variant';
  const CART_WRITE_ENDPOINTS = [
    '/cart/add',
    '/cart/change',
    '/cart/update',
    '/cart/clear'
  ];
  const GUARDIAN_HEADER = 'X-Mars-Guardian';
  const SECTION_IDS = ['cart-drawer', 'cart-icon-bubble', 'cart-notification', 'main-cart-items', 'main-cart-footer'];

  let reconciling = false;
  let pendingReconcile = false;

  /* ----------------------------- helpers ----------------------------- */

  function urlToString(input) {
    if (!input) return '';
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input.url) return input.url;
    return String(input);
  }

  function isCartWriteUrl(url) {
    if (!url) return false;
    return CART_WRITE_ENDPOINTS.some((p) => url.indexOf(p) !== -1);
  }

  function headersHasGuardian(init) {
    if (!init) return false;
    const h = init.headers;
    if (!h) return false;
    if (typeof h.get === 'function') {
      try { return !!h.get(GUARDIAN_HEADER); } catch (_) { return false; }
    }
    if (typeof h === 'object') {
      for (const k in h) {
        if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === GUARDIAN_HEADER.toLowerCase()) {
          return !!h[k];
        }
      }
    }
    return false;
  }

  function getProp(item, key) {
    if (!item) return undefined;
    const props = item.properties;
    if (!props) return undefined;
    if (Array.isArray(props)) {
      const found = props.find((p) => p && (p.name === key || p[0] === key));
      if (!found) return undefined;
      return found.value !== undefined ? found.value : found[1];
    }
    return props[key];
  }

  function isGift(item) {
    return String(getProp(item, FREE_GIFT_PROP) || '').toLowerCase() === 'true';
  }

  async function fetchCart() {
    const res = await window.__marsOriginalFetch('/cart.js', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', [GUARDIAN_HEADER]: '1' }
    });
    return res.json();
  }

  async function bulkUpdate(updates) {
    return window.__marsOriginalFetch('/cart/update.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [GUARDIAN_HEADER]: '1'
      },
      body: JSON.stringify({ updates })
    });
  }

  /* ---------------------- in-place section refresh ------------------ */

  async function refreshCartSections() {
    try {
      const url = `/?sections=${SECTION_IDS.join(',')}`;
      const res = await window.__marsOriginalFetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { [GUARDIAN_HEADER]: '1' }
      });
      const data = await res.json();
      if (!data) return;

      const parser = new DOMParser();

      const cartDrawerHtml = data['cart-drawer'];
      if (cartDrawerHtml) {
        const fresh = parser.parseFromString(cartDrawerHtml, 'text/html');
        const freshInner = fresh.querySelector('#CartDrawer');
        const currentInner = document.querySelector('#CartDrawer');
        if (freshInner && currentInner) {
          currentInner.innerHTML = freshInner.innerHTML;
          const freshOuter = fresh.querySelector('cart-drawer');
          const currentOuter = document.querySelector('cart-drawer');
          if (freshOuter && currentOuter) {
            const isEmpty = freshOuter.classList.contains('is-empty');
            currentOuter.classList.toggle('is-empty', isEmpty);
          }
        }
      }

      const bubbleHtml = data['cart-icon-bubble'];
      if (bubbleHtml) {
        const fresh = parser.parseFromString(bubbleHtml, 'text/html');
        const freshBubble = fresh.querySelector('#cart-icon-bubble');
        const currentBubble = document.querySelector('#cart-icon-bubble');
        if (freshBubble && currentBubble) currentBubble.innerHTML = freshBubble.innerHTML;
      }

      const cartItemsHtml = data['main-cart-items'];
      if (cartItemsHtml) {
        const fresh = parser.parseFromString(cartItemsHtml, 'text/html');
        const freshItems = fresh.querySelector('cart-items, #main-cart-items, .cart__items');
        const currentItems = document.querySelector('cart-items, #main-cart-items, .cart__items');
        if (freshItems && currentItems) currentItems.innerHTML = freshItems.innerHTML;
      }

      const cartFooterHtml = data['main-cart-footer'];
      if (cartFooterHtml) {
        const fresh = parser.parseFromString(cartFooterHtml, 'text/html');
        const freshFooter = fresh.querySelector('#main-cart-footer, .cart__footer');
        const currentFooter = document.querySelector('#main-cart-footer, .cart__footer');
        if (freshFooter && currentFooter) currentFooter.innerHTML = freshFooter.innerHTML;
      }

      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      document.dispatchEvent(new CustomEvent('cart:update', { bubbles: true }));
    } catch (e) {
      console.warn('[mars-cart-guardian] section refresh failed', e);
    }
  }

  /* --------------------------- reconciliation ----------------------- */

  function scheduleReconcile() {
    if (reconciling) {
      pendingReconcile = true;
      return;
    }
    setTimeout(reconcile, 80);
  }

  async function reconcile() {
    if (reconciling) {
      pendingReconcile = true;
      return;
    }
    reconciling = true;
    try {
      const cart = await fetchCart();
      if (!cart || !Array.isArray(cart.items)) return;

      const mainVariantIdsInCart = new Set(
        cart.items.filter((it) => !isGift(it)).map((it) => String(it.variant_id))
      );

      const updates = {};
      let mutated = false;

      for (const item of cart.items) {
        if (!isGift(item)) continue;
        const requiredMain = String(getProp(item, MAIN_VARIANT_PROP) || '');
        if (requiredMain && !mainVariantIdsInCart.has(requiredMain)) {
          updates[item.key] = 0;
          mutated = true;
          continue;
        }
        if (item.quantity !== 1) {
          updates[item.key] = 1;
          mutated = true;
        }
      }

      if (mutated) {
        await bulkUpdate(updates);
        await refreshCartSections();
      }
    } catch (e) {
      console.warn('[mars-cart-guardian] reconcile failed', e);
    } finally {
      reconciling = false;
      if (pendingReconcile) {
        pendingReconcile = false;
        setTimeout(reconcile, 80);
      }
    }
  }

  /* --------------------- fetch interceptor (early) ------------------ */

  window.__marsOriginalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const url = urlToString(input);
    const triggersCart = isCartWriteUrl(url);
    const isGuardian = headersHasGuardian(init);
    const promise = window.__marsOriginalFetch(input, init);
    if (triggersCart && !isGuardian) {
      promise.then((res) => {
        if (res && (res.ok || res.status === 200)) scheduleReconcile();
      }).catch(() => {});
    }
    return promise;
  };

  /* ---------------------- XHR interceptor (early) ------------------- */

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR && OriginalXHR.prototype) {
    const origOpen = OriginalXHR.prototype.open;
    const origSend = OriginalXHR.prototype.send;
    const origSetHeader = OriginalXHR.prototype.setRequestHeader;

    OriginalXHR.prototype.open = function (method, url) {
      this.__marsUrl = url || '';
      this.__marsGuardian = false;
      return origOpen.apply(this, arguments);
    };

    OriginalXHR.prototype.setRequestHeader = function (name, value) {
      if (name && String(name).toLowerCase() === GUARDIAN_HEADER.toLowerCase()) {
        this.__marsGuardian = true;
      }
      return origSetHeader.apply(this, arguments);
    };

    OriginalXHR.prototype.send = function () {
      const triggersCart = isCartWriteUrl(this.__marsUrl);
      const isGuardian = this.__marsGuardian;
      if (triggersCart && !isGuardian) {
        this.addEventListener('loadend', () => {
          if (this.status >= 200 && this.status < 400) scheduleReconcile();
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  /* --------------------------- initial pass ------------------------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reconcile, { once: true });
  } else {
    reconcile();
  }
})();
