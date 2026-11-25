(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;   // textContent: tags are user-entered
    return n;
  };

  function bars(host, rows, emptyText) {
    host.replaceChildren();
    if (!rows.length) { host.append(el('p', 'empty', emptyText)); return; }
    const max = Math.max(...rows.map(r => r.total), 1);
    rows.forEach(r => {
      const row = el('div', 'barRow');
      const head = el('div', 'barHead');
      head.append(el('span', 'barLabel', r.label || 'None'),
                  el('span', 'barCount', `${r.completed}/${r.total}`));
      const track = el('div', 'barTrack');
      const all = el('div', 'barAll');
      all.style.width = (r.total / max * 100) + '%';
      const done = el('div', 'barDone');
      done.style.width = (r.total ? r.completed / r.total * 100 : 0) + '%';
      all.append(done);
      track.append(all);
      row.append(head, track);
      host.append(row);
    });
  }

  function columns(host, days) {
    host.replaceChildren();
    const max = Math.max(...days.map(d => d.created), 1);
    days.forEach(d => {
      const col = el('div', 'col');
      const bar = el('div', 'colBar');
      bar.style.height = (d.created / max * 100) + '%';
      bar.title = `${d.created} added`;
      const [y, m, dd] = d.day.split('-').map(Number);
      const name = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short' });
      col.append(el('span', 'colNum', String(d.created)), bar, el('span', 'colDay', name));
      host.append(col);
    });
  }

  fetch('/api/stats')
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(d => {
      const t = d.totals;
      $('scopeName').textContent = d.list_name;
      $('tTotal').textContent = t.total;
      $('tDone').textContent = t.completed;
      $('tPending').textContent = t.pending;
      $('tOverdue').textContent = t.overdue;
      $('tToday').textContent = t.due_today;
      $('tWeek').textContent = t.due_week;
      $('rate').textContent = t.completion_rate + '%';
      const circ = 2 * Math.PI * 52, ring = $('ringFill');
      ring.style.strokeDasharray = circ;
      ring.style.strokeDashoffset = circ * (1 - t.completion_rate / 100);

      const order = { High: 0, Medium: 1, Low: 2 };
      bars($('byPriority'), [...d.by_priority].sort((a, b) => (order[a.label] ?? 9) - (order[b.label] ?? 9)), 'No tasks yet.');
      bars($('byTag'), d.by_tag, 'No tasks yet.');
      columns($('last7'), d.last7);

      $('statsMsg').hidden = true;
      $('statsBody').hidden = false;
    })
    .catch(() => { $('statsMsg').textContent = 'Could not load stats. Refresh to try again.'; });
})();