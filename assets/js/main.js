(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Code blocks: tab groups first, then lone blocks, so a block is wrapped once.
  // Rouge wraps known languages in div.highlighter-rouge; unknown ones (promql) stay a bare <pre>.
  const BLOCK = ':scope > .highlighter-rouge, :scope > pre';
  const langOf = (b) => b.dataset.label || (`${b.className} ${b.querySelector('code')?.className}`.match(/language-(\S+)/) || [])[1] || 'text';
  const copyBtn = '<button type="button" class="code-copy">복사</button>';

  document.querySelectorAll('.code-tabs').forEach((group, g) => {
    const blocks = [...group.querySelectorAll(BLOCK)];
    const head = document.createElement('div');
    head.className = 'code-head';
    head.setAttribute('role', 'tablist');
    blocks.forEach((b, i) => {
      b.id = `code-${g}-${i}`;
      b.setAttribute('role', 'tabpanel');
      b.hidden = i > 0;
      head.insertAdjacentHTML('beforeend', `<button type="button" class="code-tab" role="tab" aria-controls="${b.id}" aria-selected="${i === 0}">${esc(langOf(b))}</button>`);
    });
    head.insertAdjacentHTML('beforeend', copyBtn);
    group.classList.add('code');
    group.prepend(head);
    head.addEventListener('click', (e) => {
      const tab = e.target.closest('.code-tab');
      if (!tab) return;
      head.querySelectorAll('.code-tab').forEach((t) => t.setAttribute('aria-selected', t === tab));
      blocks.forEach((b) => { b.hidden = b.id !== tab.getAttribute('aria-controls'); });
    });
  });

  document.querySelectorAll('.prose > .highlighter-rouge, .prose > pre').forEach((b) => {
    const box = document.createElement('div');
    box.className = 'code';
    box.innerHTML = `<div class="code-head"><span class="code-lang">${esc(langOf(b))}</span>${copyBtn}</div>`;
    b.before(box);
    box.append(b);
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-copy');
    if (!btn) return;
    const block = [...btn.closest('.code').querySelectorAll(BLOCK)].find((b) => !b.hidden);
    try {
      await navigator.clipboard.writeText(block.querySelector('code').innerText);
      btn.textContent = '복사됨';
    } catch {
      btn.textContent = '복사 실패';
    }
    setTimeout(() => { btn.textContent = '복사'; }, 1500);
  });

  document.querySelectorAll('.prose > table').forEach((t) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.before(wrap);
    wrap.append(t);
  });

  // Table of contents with scroll tracking.
  const toc = document.getElementById('toc');
  const heads = [...document.querySelectorAll('.prose h2, .prose h3')];
  if (toc && heads.length) {
    const links = heads.map((h, i) => {
      if (!h.id) h.id = `h-${i}`;
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.className = `depth-${h.tagName[1]}`;
      a.textContent = h.textContent;
      toc.append(a);
      return a;
    });
    const spy = () => {
      let cur = 0;
      heads.forEach((h, i) => { if (h.getBoundingClientRect().top < 120) cur = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === cur));
    };
    addEventListener('scroll', spy, { passive: true });
    spy();
  } else if (toc) {
    toc.closest('aside').hidden = true;
  }

  // Search over search.json.
  const dlg = document.getElementById('search');
  const input = dlg.querySelector('input');
  const list = dlg.querySelector('ul');
  let posts = null;

  const highlight = (s, q) => {
    const safe = esc(s);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(esc(q).toLowerCase());
    return i < 0 ? safe : `${safe.slice(0, i)}<mark>${safe.slice(i, i + esc(q).length)}</mark>${safe.slice(i + esc(q).length)}`;
  };
  const snippet = (p, q) => {
    const at = q ? (p.text || '').toLowerCase().indexOf(q) : -1;
    if (at < 0) return p.description || p.date;
    const from = Math.max(0, at - 40);
    return (from ? '…' : '') + p.text.slice(from, at + q.length + 60) + '…';
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const hits = (posts || [])
      .map((p) => {
        const body = [p.description, p.series, (p.tags || []).join(' '), p.text].join(' ').toLowerCase();
        return { p, score: !q ? 1 : p.title.toLowerCase().includes(q) ? 2 : body.includes(q) ? 1 : 0 };
      })
      .filter((h) => h.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    list.innerHTML = hits.length
      ? hits.map(({ p }) => `<li><a href="${esc(p.url)}"><b>${highlight(p.title, q)}</b><small>${highlight(snippet(p, q), q)}</small></a></li>`).join('')
      : `<li class="empty">${posts ? '결과가 없습니다.' : '불러오는 중…'}</li>`;
  };
  const open = async () => {
    if (!dlg.open) dlg.showModal();
    input.select();
    render();
    if (!posts) {
      posts = await fetch(document.body.dataset.search).then((r) => r.json()).catch(() => []);
      render();
    }
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    const first = list.querySelector('a');
    if (e.key === 'Enter' && first) location.href = first.href;
    if (e.key === 'ArrowDown' && first) { e.preventDefault(); first.focus(); }
  });
  list.addEventListener('keydown', (e) => {
    const a = e.target.closest('li');
    if (e.key === 'ArrowDown') { e.preventDefault(); a.nextElementSibling?.querySelector('a')?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (a.previousElementSibling?.querySelector('a') || input).focus(); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.querySelectorAll('[data-search-open]').forEach((b) => b.addEventListener('click', open));
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      open();
    }
  });
})();
