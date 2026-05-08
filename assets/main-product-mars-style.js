/* =====================================================================
   <mars-product-form> custom element
   ---------------------------------------------------------------------
   - Submits a single /cart/add.js call with: main variant + selling plan
     + free gift variants. Each gift is tagged with `_free_gift: 'true'`
     and `_main_variant: '<main variant id>'` so mars-cart-guardian.js
     can enforce: gifts always quantity 1, gifts removed if main is.
   - On success the cart drawer / cart icon sections are re-fetched and
     patched in place (no page reload), then the drawer is opened.
===================================================================== */
(function () {
  const SECTION_IDS = ['cart-drawer', 'cart-icon-bubble'];

  /* ---------------------- in-place cart refresh --------------------- */

  async function refreshCartSections() {
    try {
      const url = `/?sections=${SECTION_IDS.join(',')}`;
      const fetcher = window.__marsOriginalFetch || window.fetch;
      const res = await fetcher.call(window, url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'X-Mars-Guardian': '1' }
      });
      const data = await res.json();
      const parser = new DOMParser();

      const cartDrawerHtml = data && data['cart-drawer'];
      if (cartDrawerHtml) {
        const fresh = parser.parseFromString(cartDrawerHtml, 'text/html');
        const freshInner = fresh.querySelector('#CartDrawer');
        const currentInner = document.querySelector('#CartDrawer');
        if (freshInner && currentInner) {
          currentInner.innerHTML = freshInner.innerHTML;
          const freshOuter = fresh.querySelector('cart-drawer');
          const currentOuter = document.querySelector('cart-drawer');
          if (freshOuter && currentOuter) {
            currentOuter.classList.toggle('is-empty', freshOuter.classList.contains('is-empty'));
          }
        }
      }

      const bubbleHtml = data && data['cart-icon-bubble'];
      if (bubbleHtml) {
        const fresh = parser.parseFromString(bubbleHtml, 'text/html');
        const freshBubble = fresh.querySelector('#cart-icon-bubble');
        const currentBubble = document.querySelector('#cart-icon-bubble');
        if (freshBubble && currentBubble) currentBubble.innerHTML = freshBubble.innerHTML;
      }
    } catch (e) {
      console.warn('[mars-product-form] section refresh failed', e);
    }
  }

  /* ----------------------- cart drawer opener ----------------------- */

  function openCartDrawer(maxAttempts = 20) {
    let attempts = 0;
    const tryOnce = () => {
      attempts += 1;
      const drawer = document.querySelector('cart-drawer');
      if (drawer) {
        if (typeof drawer.open === 'function') {
          try { drawer.open(); return; } catch (_) {}
        }
        drawer.classList.add('active');
        document.documentElement.classList.add('cart-drawer-open');
        return;
      }
      const cartIcon =
        document.querySelector('[data-cart-icon-bubble], #cart-icon-bubble, a[href="/cart"], .header__icon--cart');
      if (cartIcon) { cartIcon.click(); return; }
      if (attempts < maxAttempts) setTimeout(tryOnce, 150);
    };
    tryOnce();
  }

  /* --------------------------- form element ------------------------- */

  class MarsProductForm extends HTMLElement {
    constructor() {
      super();
      this.button = this.querySelector('[data-mars-atc]');
      this.errorEl = this.querySelector('[data-mars-error]');
      this.gallery = document.querySelector(`[data-mars-gallery="${this.dataset.section}"]`);
      if (this.button) this.button.addEventListener('click', this.onSubmit.bind(this));
    }

    connectedCallback() {
      this.initGallery();
    }

    /* ----------------------------- gallery ----------------------------- */
    initGallery() {
      if (!this.gallery) return;
      const main = this.gallery.querySelector('[data-mars-main-img]');
      const mainWrap = this.gallery.querySelector('.pdp-mars__gallery-main');
      const thumbs = Array.from(this.gallery.querySelectorAll('[data-mars-thumb]'));
      if (!main || !thumbs.length) return;

      let activeIndex = Math.max(0, thumbs.findIndex((t) => t.classList.contains('is-active')));
      if (activeIndex < 0) activeIndex = 0;

      const thumbStrip = this.gallery.querySelector('.pdp-mars__gallery-thumbs');

      /** Keeps thumb visible without scrollIntoView (which can scroll the whole page horizontally). */
      const scrollThumbIntoStrip = (thumbBtn) => {
        if (!thumbStrip || !thumbBtn) return;
        const target =
          thumbBtn.offsetLeft - thumbStrip.clientWidth / 2 + thumbBtn.offsetWidth / 2;
        thumbStrip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      };

      const setActive = (index) => {
        if (!thumbs.length) return;
        const normalized = ((index % thumbs.length) + thumbs.length) % thumbs.length;
        const t = thumbs[normalized];
        const src = t.dataset.full || t.querySelector('img')?.src;
        const srcset = t.dataset.fullSrcset || '';
        if (src) {
          main.src = src;
          if (srcset) main.srcset = srcset;
        }
        thumbs.forEach((x) => x.classList.remove('is-active'));
        t.classList.add('is-active');
        activeIndex = normalized;
        scrollThumbIntoStrip(t);
      };

      thumbs.forEach((t, idx) => {
        t.addEventListener('click', () => setActive(idx));
      });

      // Mobile swipe support for main image.
      if (mainWrap) {
        let startX = 0;
        let startY = 0;
        let moved = false;
        const SWIPE_THRESHOLD = 30;

        mainWrap.addEventListener(
          'touchstart',
          (evt) => {
            const touch = evt.touches && evt.touches[0];
            if (!touch) return;
            startX = touch.clientX;
            startY = touch.clientY;
            moved = false;
          },
          { passive: true }
        );

        mainWrap.addEventListener(
          'touchmove',
          (evt) => {
            const touch = evt.touches && evt.touches[0];
            if (!touch) return;
            const dx = Math.abs(touch.clientX - startX);
            const dy = Math.abs(touch.clientY - startY);
            // Treat as horizontal swipe only if horizontal delta dominates.
            moved = dx > dy && dx > 8;
          },
          { passive: true }
        );

        mainWrap.addEventListener(
          'touchend',
          (evt) => {
            const touch = evt.changedTouches && evt.changedTouches[0];
            if (!touch || !moved) return;
            const deltaX = touch.clientX - startX;
            if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
            if (deltaX < 0) setActive(activeIndex + 1);
            else setActive(activeIndex - 1);
          },
          { passive: true }
        );
      }
    }

    /* ------------------------------- ATC ------------------------------- */
    async onSubmit(evt) {
      evt.preventDefault();
      if (this.button.classList.contains('is-loading')) return;
      this.setLoading(true);
      this.hideError();

      const variantId = parseInt(this.dataset.variantId || '0', 10);
      if (!variantId) {
        this.showError('Product is unavailable.');
        this.setLoading(false);
        return;
      }
      const sellingPlanId = parseInt(this.dataset.sellingPlanId || '0', 10);
      const quantity = parseInt(this.dataset.quantity || '1', 10) || 1;
      const giftIds = (this.dataset.gifts || '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((id) => Number.isFinite(id) && id > 0);

      const main = { id: variantId, quantity };
      if (sellingPlanId) main.selling_plan = sellingPlanId;

      const items = [main];
      giftIds.forEach((id) => {
        items.push({
          id,
          quantity: 1,
          properties: {
            _free_gift: 'true',
            _main_variant: String(variantId)
          }
        });
      });

      try {
        const url = (window.routes && window.routes.cart_add_url) || '/cart/add.js';
        const fetcher = window.__marsOriginalFetch || window.fetch;
        const res = await fetcher.call(window, url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/javascript',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Mars-Guardian': '1'
          },
          body: JSON.stringify({ items })
        });
        const data = await res.json();
        if (!res.ok || data.status) {
          const msg = data.description || data.message || 'Could not add to cart.';
          throw new Error(msg);
        }
        await refreshCartSections();
        openCartDrawer();
        this.setLoading(false);
      } catch (err) {
        console.error('[mars-product-form]', err);
        this.showError(err.message || 'Could not add to cart.');
        this.setLoading(false);
      }
    }

    /* ---------------------------- UI helpers --------------------------- */
    setLoading(on) {
      if (!this.button) return;
      if (on) {
        this.button.classList.add('is-loading');
        this.button.disabled = true;
      } else {
        this.button.classList.remove('is-loading');
        this.button.disabled = false;
      }
    }
    showError(msg) {
      if (!this.errorEl) return;
      this.errorEl.textContent = msg;
      this.errorEl.classList.add('is-visible');
    }
    hideError() {
      if (!this.errorEl) return;
      this.errorEl.textContent = '';
      this.errorEl.classList.remove('is-visible');
    }
  }

  if (!customElements.get('mars-product-form')) {
    customElements.define('mars-product-form', MarsProductForm);
  }
})();
