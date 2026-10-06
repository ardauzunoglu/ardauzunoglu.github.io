(() => {
  const body = document.body;
  const root = document.documentElement;
  if (!body.hasAttribute('data-reader-protected')) {
    root.classList.remove('reader-locked');
    return;
  }

  const passwordHash = '5696d539b4ffc960aacbcc0c6982392085d0a1411bc7b8eabc956d393a27c62e';
  const sessionKey = `reader-access:${window.location.pathname}`;
  const content = document.querySelector('.profile-page');

  const unlock = () => {
    root.classList.remove('reader-locked');
    content?.removeAttribute('inert');
    document.querySelector('.reader-gate')?.remove();
  };

  if (window.sessionStorage.getItem(sessionKey) === 'granted') {
    unlock();
    return;
  }

  content?.setAttribute('inert', '');
  const gate = document.createElement('section');
  gate.className = 'reader-gate';
  gate.setAttribute('aria-labelledby', 'reader-gate-title');
  gate.innerHTML = `<form class="reader-gate-card">
    <p class="reader-gate-kicker">Private post</p>
    <h1 id="reader-gate-title">Enter the reader password</h1>
    <p class="reader-gate-copy">This post is currently shared with invited readers.</p>
    <label class="reader-gate-label" for="reader-password">Password</label>
    <div class="reader-gate-controls">
      <input id="reader-password" name="password" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required>
      <button type="submit">Continue</button>
    </div>
    <p class="reader-gate-error" role="alert" hidden>Incorrect password.</p>
  </form>`;
  body.prepend(gate);

  const form = gate.querySelector('form');
  const input = gate.querySelector('input');
  const button = gate.querySelector('button');
  const error = gate.querySelector('.reader-gate-error');

  const hash = async value => {
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    error.hidden = true;
    try {
      if (await hash(input.value) !== passwordHash) {
        error.hidden = false;
        input.select();
        return;
      }
      window.sessionStorage.setItem(sessionKey, 'granted');
      unlock();
    } finally {
      button.disabled = false;
    }
  });

  input.focus();
})();
