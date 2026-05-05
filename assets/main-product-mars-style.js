/* =====================================================================
   <mars-product-form> custom element
   ---------------------------------------------------------------------
   - Submits a single /cart/add.js call with: main variant + selling plan
     + free gift variants (all in one request via the `items` array).
   - Updates cart-notification or cart-drawer if available.
   - Falls back to redirecting to /cart on success.
===================================================================== */
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

  /* --------------------------- Gallery --------------------------- */
  initGallery() {
    if (!this.gallery) return;
    const main = this.gallery.querySelector('[data-mars-main-img]');
    const thumbs = this.gallery.querySelectorAll('[data-mars-thumb]');
    if (!main || !thumbs.length) return;
    thumbs.forEach((t) => {
      t.addEventListener('click', () => {
        const src = t.dataset.full || t.querySelector('img')?.src;
        const srcset = t.dataset.fullSrcset || '';
        if (src) {
          main.src = src;
          if (srcset) main.srcset = srcset;
        }
        thumbs.forEach((x) => x.classList.remove('is-active'));
        t.classList.add('is-active');
      });
    });
  }

  /* --------------------------- ATC -------------------------------- */
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
        properties: { _free_gift: 'true' }
      });
    });

    const sectionsToRender = this.getSectionsToRender();

    try {
      const url = (window.routes && window.routes.cart_add_url) || '/cart/add.js';
      const body = { items };
      if (sectionsToRender.length) {
        body.sections = sectionsToRender.map((s) => s.id).join(',');
        body.sections_url = window.location.pathname;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/javascript',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || data.status) {
        const msg = data.description || data.message || 'Could not add to cart.';
        throw new Error(msg);
      }
      this.onAddSuccess(data);
    } catch (err) {
      console.error('[mars-product-form]', err);
      this.showError(err.message || 'Could not add to cart.');
      this.setLoading(false);
    }
  }

  onAddSuccess(data) {
    const fallback = () => {
      window.location.href = (window.routes && window.routes.cart_url) || '/cart';
    };

    // 1) Try BREAK theme cart-drawer if present.
    const drawerEl = document.querySelector('cart-drawer');
    if (drawerEl) {
      // BREAK's drawer reads cart state on open. Refresh sections then open.
      this.refreshDrawer(drawerEl)
        .then(() => {
          if (typeof drawerEl.open === 'function') drawerEl.open();
          else drawerEl.classList.add('active');
          this.setLoading(false);
        })
        .catch(() => {
          fallback();
        });
      return;
    }

    // 2) Try theme's cart-notification (renderContents API).
    const note = document.querySelector('cart-notification');
    if (note && data && data.sections && typeof note.renderContents === 'function') {
      try {
        // The first added line item's key is the freshest — use main item.
        const itemKey = (data.items && data.items[0] && data.items[0].key) || data.key;
        note.renderContents({ key: itemKey, sections: data.sections });
        this.setLoading(false);
        return;
      } catch (e) {
        console.warn('[mars-product-form] cart-notification render failed', e);
      }
    }

    // 3) Fallback — go to the cart page.
    fallback();
  }

  async refreshDrawer(drawerEl) {
    // Re-fetch /?sections=cart-drawer to get fresh HTML and patch in.
    const cartDrawerSelector = '#CartDrawer';
    const url = `${window.location.pathname}?sections=cart-drawer`;
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const json = await res.json();
      const html = json && json['cart-drawer'];
      if (!html) return;
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const fresh = parsed.querySelector(cartDrawerSelector);
      const current = drawerEl.querySelector(cartDrawerSelector);
      if (fresh && current) current.innerHTML = fresh.innerHTML;
      // Refresh icon bubble too
      const bubble = document.getElementById('cart-icon-bubble');
      if (bubble) {
        const bubbleRes = await fetch(`${window.location.pathname}?sections=cart-icon-bubble`, {
          credentials: 'same-origin'
        });
        const bubbleJson = await bubbleRes.json();
        const bubbleHTML = bubbleJson && bubbleJson['cart-icon-bubble'];
        if (bubbleHTML) {
          const tmp = new DOMParser().parseFromString(bubbleHTML, 'text/html');
          const freshBubble = tmp.querySelector('#cart-icon-bubble');
          if (freshBubble) bubble.innerHTML = freshBubble.innerHTML;
        }
      }
    } catch (e) {
      console.warn('[mars-product-form] drawer refresh failed', e);
    }
  }

  getSectionsToRender() {
    const ids = [];
    if (document.getElementById('cart-notification-product')) ids.push({ id: 'cart-notification-product' });
    if (document.getElementById('cart-notification-button')) ids.push({ id: 'cart-notification-button' });
    if (document.getElementById('cart-icon-bubble')) ids.push({ id: 'cart-icon-bubble' });
    return ids;
  }

  /* --------------------------- UI helpers ------------------------- */
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
