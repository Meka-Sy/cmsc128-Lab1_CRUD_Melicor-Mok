(() => {
  // --- DOM Elements & State Setup ---
  const $ = id => document.getElementById(id);
  const sidebar = $('listsSidebar'), toggle = $('listsToggle'), title =$('listTitle'),
        personalNav = $('personalNav'), collabNav = $('collabNav'), emptyMsg =$('listsEmpty'),
        memberBox = $('memberBox'), memberForm =$('addMemberForm'),
        listsMsg = $('listsMsg'), memberMsg =$('memberMsg');
  
  let state = { active: null, lists: [], members: [] };
  let renaming = null;               // id of the list being renamed inline
  let collapsed = false;             // active list's add-member box folded away
  let busy = false;                  // one request at a time, so double-clicks can't repeat an action

  // --- API Fetch Wrapper & DOM Utilities ---
  const api = async (url, method, body) => {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    return d;
  };
  
  const say = (node, t) => { node.textContent = t; };
  const sortLists = () => state.lists.sort((a, b) => a.name.localeCompare(b.name));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  // --- Lock Handler for Preventing Concurrent Requests ---
  async function guarded(btn, fn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try { await fn(); } finally { busy = false; if (btn) btn.disabled = false; }
  }

  // --- List Management Operations (Rename / Delete / Dropdown) ---
  async function renameList(l, name, btn) {
    name = name.trim();
    if (!name) { say(listsMsg, 'List name is required'); return; }
    if (name === l.name) { renaming = null; render(); return; }
    await guarded(btn, async () => {
      try {
        const d = await api(`/api/lists/${l.id}`, 'PATCH', { name });
        l.name = d.name;
        sortLists();
        renaming = null;
        say(listsMsg, '');
        render();
      } catch (err) { say(listsMsg, err.message); }
    });
  }

  async function deleteList(l) {
    if (!confirm(`Delete "${l.name}" and all its tasks?`)) return;
    await guarded(null, async () => {
      try {
        await api(`/api/lists/${l.id}`, 'DELETE');
        state.lists = state.lists.filter(x => x.id !== l.id);
        if (state.active === l.id) { state.active = null; window.reloadTasks?.(); }
        say(listsMsg, '');
        render();
      } catch (err) { say(listsMsg, err.message); }
    });
  }

  function optionsSelect(l) {
    const sel = el('select', 'listMenuSel');
    sel.setAttribute('aria-label', `Options for ${l.name}`);
    sel.innerHTML = '<option value="" selected hidden></option>' +
                    '<option value="rename">Rename</option><option value="delete">Delete</option>';
    sel.onchange = () => {
      const v = sel.value;
      sel.value = '';
      if (v === 'rename') { renaming = l.id; render(); }
      else if (v === 'delete') deleteList(l);
    };
    return sel;
  }

  // --- Sidebar List Item Component Builder ---
  const item = l => {
    const li = el('li'), row = el('div', 'listRow');
    const owner = l.id !== null && l.is_owner;        // only owners can rename/delete
    li.classList.toggle('active', l.id === state.active);
    if (owner && renaming === l.id) {
      const input = el('input', 'listRename');
      input.value = l.name;
      input.maxLength = 60;
      input.setAttribute('aria-label', 'List name');
      const save = el('button', 'listMenuBtn');
      save.type = 'button';
      save.setAttribute('aria-label', 'Save name');
      save.innerHTML = '<i class="bi bi-check-lg"></i>';
      save.onclick = () => renameList(l, input.value, save);
      input.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); renameList(l, input.value, save); }
        else if (e.key === 'Escape') { e.stopPropagation(); renaming = null; render(); }
      };
      row.append(input, save);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      const b = el('button', 'listItem', l.name);
      b.type = 'button';
      if (l.id === state.active) b.setAttribute('aria-current', 'true');
      b.onclick = () => switchTo(l.id);
      row.append(b);
      if (owner) row.append(optionsSelect(l));
    }
    li.append(row);
    return li;
  };

  // --- UI Render Helpers (Members & Main Sidebar Layout) ---
  function renderMembers() {
    let ul = $('memberListUI');
    if (!ul) {
      ul = el('ul', 'memberListUI');
      ul.id = 'memberListUI';
      memberBox.appendChild(ul);
    }
    
    ul.replaceChildren(...state.members.map(m => el('li', 'memberItem', m.display_name)));
  }

  function render() {
    const cur = state.lists.find(l => l.id === state.active);
    personalNav.replaceChildren(item({ id: null, name: 'Personal' }));
    collabNav.replaceChildren(...state.lists.map(item));
    emptyMsg.hidden = state.lists.length > 0;
    
    // owners get the add-member box inside the card of the list they're viewing
    memberBox.hidden = collapsed || !(cur && cur.is_owner);
    if (!memberBox.hidden) {
        collabNav.children[state.lists.indexOf(cur)].append(memberBox);
        renderMembers();
    }
    title.textContent = cur ? cur.name : 'To-Do List';
  }

  // --- Async Member Fetching & Switching Active List ---
  async function fetchMembers(listId) {
    if (listId === null) {
      state.members = [];
      return;
    }
    try {
      state.members = await api(`/api/lists/${listId}/members`, 'GET');
    } catch (e) {
      state.members = [];
    }
  }

  async function switchTo(id) {
    if (id === state.active) {        // clicking the open list again folds/unfolds its box
      if (id !== null) { collapsed = !collapsed; render(); }
      return;
    }
    if (busy) return;
    busy = true;
    try {
      await api('/api/lists/active', 'PUT', { list_id: id });
      state.active = id;
      renaming = null;
      collapsed = false;
      say(listsMsg, '');
      say(memberMsg, '');
      
      await fetchMembers(id);

      render();
      window.reloadTasks?.();         // defined in home.js
    } catch (e) { say(listsMsg, e.message); }
    finally { busy = false; }
  }

  // --- Sidebar Toggle & Keyboard Accessibility Handlers ---
  const setOpen = open => {
    if (!open && sidebar.contains(document.activeElement)) toggle.focus();
    sidebar.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  
  toggle.onclick = () => setOpen(sidebar.hidden);
  $('listsClose').onclick = () => setOpen(false);
  
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !sidebar.hidden) setOpen(false);
  });

  // --- Form Handlers (Create List & Add Member) ---
  $('newListForm').onsubmit = async e => {
    e.preventDefault();
    const input = $('newListName');
    let created = null;
    await guarded(e.submitter, async () => {
      try {
        created = await api('/api/lists', 'POST', { name: input.value });
        input.value = '';
        state.lists.push(created);
        sortLists();
      } catch (err) { say(listsMsg, err.message); }
    });
    if (created) await switchTo(created.id);   // open the new list
  };

  memberForm.onsubmit = async e => {
    e.preventDefault();
    const input = $('memberIdent');
    await guarded(e.submitter, async () => {
      try {
        const m = await api(`/api/lists/${state.active}/members`, 'POST', { user: input.value });
        input.value = '';
        say(memberMsg, m.already ? `${m.display_name} is already in this list.` : `Added ${m.display_name}.`);
        
        if (!m.already) {
            state.members.push({ id: m.id, display_name: m.display_name });
            renderMembers();
        }
      } catch (err) { say(memberMsg, err.message); }
    });
  };

  // --- Initial Execution: Load User Lists & Active State ---
  api('/api/lists', 'GET').then(async d => { 
    state.active = d.active;
    state.lists = d.lists || [];
    if (state.active !== null) {
      await fetchMembers(state.active);
    }
    render(); 
  }).catch(() => {});
})();