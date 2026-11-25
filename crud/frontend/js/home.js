document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const taskList = $('taskList'), emptyState = $('emptyState'), taskForm = $('taskForm'),
          formMsg = $('formMsg'), toast = $('undoToast');

    // ---- Options (single source for the filter, add-form and edit-row dropdowns) ----
    const PRIORITIES = ['High', 'Medium', 'Low'];
    const TAGS = ['Personal', 'Work', 'Finance'];
    const RANK = { High: 3, Medium: 2, Low: 1 };
    const opts = (list, sel) => list.map(v => `<option${v === sel ? ' selected' : ''}>${v}</option>`).join('');

    $('taskPriorityLevel').innerHTML = opts(PRIORITIES, 'Medium');
    $('taskTag').innerHTML = opts(TAGS, 'Personal');

    // ---- State ----
    let tasks = [];
    let editingId = null;      // task currently being edited inline
    let pending = null;        // { task, index } deleted but still undoable
    let loadSeq = 0;           // ignore out-of-order responses when lists are switched quickly
    const filters = { priority: '', tag: '' };
    let sorts = [];            // [{ field, dir }] in the order they were activated; first = primary

    // ---- Sorting: any number of fields can be active at once ----
    // sorts = [{ field, dir }] in the order they were activated; the first is the primary sort.
    // labels = [asc, desc]. Tasks missing a value (e.g. no due date) always go last.
    const SORTS = {
        due_date:     { name: 'Due date',   labels: ['Earliest first', 'Latest first'], key: t => t.due_date ? Date.parse(t.due_date) : null },
        priority:     { name: 'Priority',   labels: ['Low to high', 'High to low'],     key: t => RANK[t.priority] || 0 },
        tag:          { name: 'Tag',        labels: ['A to Z', 'Z to A'],               key: t => (t.tag || '').toLowerCase() },
        date_created: { name: 'Date added', labels: ['Oldest first', 'Newest first'],   key: t => Date.parse(t.date_created) },
    };

    function compare(a, b) {
        for (const { field, dir } of sorts) {
            const x = SORTS[field].key(a), y = SORTS[field].key(b);
            if (x === y) continue;
            if (x === null) return 1;
            if (y === null) return -1;
            return (x < y ? -1 : 1) * (dir === 'asc' ? 1 : -1);
        }
        return 0;
    }

    function setSort(field, dir) {
        const i = sorts.findIndex(s => s.field === field);
        if (!dir) { if (i > -1) sorts.splice(i, 1); }
        else if (i > -1) sorts[i].dir = dir;
        else sorts.push({ field, dir });
        saveView();
        render();
    }

    // ---- Remember the view (filters + sort order) across reloads ----
    const VIEW_KEY = 'todo.view';
    function saveView() {
        try { localStorage.setItem(VIEW_KEY, JSON.stringify({ filters, sorts })); } catch { /* storage blocked: just don't persist */ }
    }
    function loadView() {
        try {
            const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
            // only restore values that still exist, so a stale saved value can never hide every task
            if (PRIORITIES.includes(v.filters?.priority)) filters.priority = v.filters.priority;
            if (TAGS.includes(v.filters?.tag)) filters.tag = v.filters.tag;
            const seen = new Set();
            sorts = (Array.isArray(v.sorts) ? v.sorts : []).filter(s =>
                s && SORTS[s.field] && (s.dir === 'asc' || s.dir === 'desc') && !seen.has(s.field) && seen.add(s.field));
        } catch { /* corrupt or unavailable: start with defaults */ }
    }

    // ---- Toolbar: filter + sort pills share one dropdown component ----
    const closeMenus = () => document.querySelectorAll('.menuPop').forEach(m => {
        m.hidden = true;
        m.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

    // items: [{ value, html }]; onPick(value) runs when one is chosen
    function pillMenu(cat, items, onPick) {
        const root = document.createElement('div');
        root.className = 'pillMenu';
        root.dataset.cat = cat;
        root.innerHTML = '<button type="button" class="pillBtn" aria-haspopup="menu" aria-expanded="false"></button><div class="menuPop" role="menu" hidden></div>';
        const [btn, pop] = root.children;
        items.forEach(it => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'menuItem';
            b.setAttribute('role', 'menuitemradio');
            b.dataset.value = it.value;
            b.innerHTML = it.html;
            b.onclick = () => { closeMenus(); onPick(it.value); };
            pop.append(b);
        });
        btn.onclick = e => {
            e.stopPropagation();
            const open = pop.hidden;
            closeMenus();
            pop.hidden = !open;
            btn.setAttribute('aria-expanded', String(open));
        };
        return root;
    }

    const FILTERS = [
        { key: 'priority', name: 'Priority', all: 'All priorities', list: PRIORITIES },
        { key: 'tag',      name: 'Tag',      all: 'All tags',       list: TAGS },
    ];
    FILTERS.forEach(({ key, all, list }) => {
        const items = [{ value: '', html: all }, ...list.map(v => ({ value: v, html: v }))];
        const menu = pillMenu(key, items, v => { filters[key] = v; saveView(); render(); });
        menu.dataset.filter = key;
        $('filterBar').append(menu);
    });
    Object.entries(SORTS).forEach(([field, cfg]) => {
        const items = [
            { value: 'asc',  html: `<i class="bi bi-arrow-up"></i> ${cfg.labels[0]}` },
            { value: 'desc', html: `<i class="bi bi-arrow-down"></i> ${cfg.labels[1]}` },
            { value: '',     html: '<i class="bi bi-x-lg"></i> Clear sort' },
        ];
        const menu = pillMenu(field, items, dir => setSort(field, dir));
        menu.dataset.sort = field;
        $('sortBar').append(menu);
    });

    function updateToolbar() {
        document.querySelectorAll('.pillMenu').forEach(root => {
            const btn = root.firstElementChild;
            let current;
            if (root.dataset.sort) {
                const field = root.dataset.sort, i = sorts.findIndex(s => s.field === field), s = sorts[i];
                current = s ? s.dir : '';
                btn.innerHTML = SORTS[field].name + (s
                    ? ` <i class="dirIcon bi bi-arrow-${s.dir === 'asc' ? 'up' : 'down'}"></i>${sorts.length > 1 ? `<sup class="order">${i + 1}</sup>` : ''}`
                    : ' <i class="bi bi-chevron-down"></i>');
            } else {
                const f = FILTERS.find(f => f.key === root.dataset.filter);
                current = filters[f.key];
                btn.innerHTML = (current ? `${f.name}: ${esc(current)}` : f.all) + ' <i class="bi bi-chevron-down"></i>';
            }
            root.classList.toggle('active', !!current);
            root.querySelectorAll('.menuItem').forEach(it => {
                const on = !!current && it.dataset.value === current;
                it.classList.toggle('current', on);
                it.setAttribute('aria-checked', String(on));
            });
        });
    }

    // ---- Rendering ----
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const today = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD in local time
    const taskOf = el => tasks.find(t => String(t.id) === el.closest('li').dataset.id);

    // ---- Form dropdowns (add task + inline edit) ----
    // A native <select> opens an OS-styled list that CSS can't touch. Each select stays in the form as the
    // hidden value holder, and is shown as a button + the same popup menu the toolbar pills use.
    function enhanceSelect(sel) {
        if (sel.dataset.enhanced) return;
        sel.dataset.enhanced = '1';
        const root = document.createElement('div');
        root.className = 'fieldMenu';
        root.dataset.cat = sel.name;   // 'priority' | 'tag' picks the tint
        root.innerHTML = '<button type="button" class="ctl selBtn" aria-haspopup="listbox" aria-expanded="false"></button><div class="menuPop" role="listbox" hidden></div>';
        const [btn, pop] = root.children;
        if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));

        const sync = () => {
            btn.textContent = sel.value;
            pop.querySelectorAll('.menuItem').forEach(it => {
                const on = it.dataset.value === sel.value;
                it.classList.toggle('current', on);
                it.setAttribute('aria-selected', String(on));
            });
        };
        [...sel.options].forEach(o => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'menuItem';
            b.setAttribute('role', 'option');
            b.dataset.value = o.value;
            b.textContent = o.value;
            b.onclick = () => { closeMenus(); sel.value = o.value; sync(); btn.focus(); };
            pop.append(b);
        });
        btn.onclick = e => {
            e.stopPropagation();
            const open = pop.hidden;
            closeMenus();
            pop.hidden = !open;
            btn.setAttribute('aria-expanded', String(open));
        };
        root.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !pop.hidden) {
                e.stopPropagation();   // close the menu without also cancelling an inline edit
                closeMenus();
                btn.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (pop.hidden) btn.click();
                const items = [...pop.children], at = items.indexOf(document.activeElement);
                const next = at < 0 ? items.findIndex(i => i.classList.contains('current')) : at + (e.key === 'ArrowDown' ? 1 : -1);
                items[(next + items.length) % items.length].focus();
            }
        });

        sel.hidden = true;
        sel.before(root);
        root.append(sel);
        sync();
        sel.form?.addEventListener('reset', () => setTimeout(sync));   // taskForm.reset() after adding a task
    }
    [$('taskPriorityLevel'), $('taskTag')].forEach(enhanceSelect);

    function rowHtml(t) {
        if (t.id === editingId) return editHtml(t);
        const priority = t.priority || 'Low';
        const overdue = t.due_date && !t.done && t.due_date < today();
        return `
        <li class="task-item${t.done ? ' completed' : ''}" data-id="${esc(t.id)}">
            <input type="checkbox" class="taskCheckbox" aria-label="Mark ${esc(t.name)} as done"${t.done ? ' checked' : ''}>
            <span class="taskName">${esc(t.name)}</span>
            <span class="taskAdded" title="Date added">Added ${fmt(t.date_created)}</span>
            <span class="taskMeta">
                ${t.due_date ? `<span class="pill pillDue${overdue ? ' overdue' : ''}" title="${overdue ? 'Overdue' : 'Due date'}"><i class="bi ${overdue ? 'bi-exclamation-circle-fill' : 'bi-calendar-event'}"></i>${fmt(t.due_date + 'T00:00')}</span>` : ''}
                <span class="pill priority-${priority.toLowerCase()}" title="Priority"><img class="pillIcon" src="/images/priorityImage.png" alt="">${esc(priority)}</span>
                <span class="pill pillTag" title="Tag"><i class="bi bi-tag-fill"></i>${esc(t.tag || 'General')}</span>
            </span>
            <div class="taskActions">
                <button type="button" class="iconBtn" data-act="edit" aria-label="Edit ${esc(t.name)}" title="Edit"><i class="bi bi-pencil"></i></button>
                <button type="button" class="iconBtn danger" data-act="delete" aria-label="Delete ${esc(t.name)}" title="Delete"><i class="bi bi-trash"></i></button>
            </div>
        </li>`;
    }

    function editHtml(t) {
        const tags = !t.tag || TAGS.includes(t.tag) ? TAGS : [...TAGS, t.tag];   // keep unknown legacy tags selectable
        return `
        <li class="task-item editing" data-id="${esc(t.id)}">
            <form class="editForm">
                <input class="ctl" name="name" value="${esc(t.name)}" required aria-label="Task name">
                <div class="editFields">
                    <select class="ctl" name="priority" aria-label="Priority">${opts(PRIORITIES, t.priority)}</select>
                    <select class="ctl" name="tag" aria-label="Tag">${opts(tags, t.tag)}</select>
                    <input class="ctl" type="date" name="due_date" value="${esc(t.due_date || '')}" aria-label="Due date">
                </div>
                <div class="editBtns">
                    <button type="button" class="btn btnGhost" data-act="cancel">Cancel</button>
                    <button type="submit" class="btn btnPrimary">Save</button>
                </div>
            </form>
        </li>`;
    }

    function render() {
        updateToolbar();
        const visible = tasks
            .filter(t => (!filters.priority || (t.priority || 'Low') === filters.priority) &&
                         (!filters.tag || (t.tag || 'General') === filters.tag))
            .sort(compare);
        taskList.innerHTML = visible.map(rowHtml).join('');
        taskList.querySelectorAll('select').forEach(enhanceSelect);   // inline-edit dropdowns
        emptyState.hidden = visible.length > 0;
        emptyState.textContent = tasks.length ? 'No tasks match these filters.' : 'No tasks yet — add one to get started.';
    }

    // ---- Per-task actions (toggle done / edit / save / cancel / delete) ----
    taskList.addEventListener('change', async e => {
        if (!e.target.classList.contains('taskCheckbox')) return;
        const task = taskOf(e.target);
        try {
            const res = await fetch(`/api/tasks/${task.id}/toggle`, { method: 'PATCH' });
            if (!res.ok) throw new Error('toggle failed');
            task.done = (await res.json()).done;
            e.target.closest('li').classList.toggle('completed', !!task.done);
        } catch (err) {
            e.target.checked = !e.target.checked;
            alert('Could not update the task. Please try again.');
        }
    });

    taskList.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const task = taskOf(btn);
        if (btn.dataset.act === 'edit') {
            editingId = task.id;
            render();
            taskList.querySelector('.editForm input').focus();
        } else if (btn.dataset.act === 'cancel') {
            editingId = null;
            render();
        } else if (btn.dataset.act === 'delete') {
            removeTask(task);
        }
    });

    taskList.addEventListener('keydown', e => {
        if (e.key === 'Escape' && editingId !== null) { editingId = null; render(); }
    });

    taskList.addEventListener('submit', async e => {
        e.preventDefault();
        const task = taskOf(e.target);
        const body = Object.fromEntries(new FormData(e.target));
        body.name = body.name.trim();
        try {
            const res = await fetch(`/api/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not save the task.');
            Object.assign(task, data);
            editingId = null;
            render();
        } catch (err) {
            alert(err.message);
        }
    });

    // ---- Delete with a 5 second undo window; the real DELETE fires when it closes ----
    // The toast is shared with lists.js (window.undoToast): one undo window at a time, and starting a
    // new delete commits the previous one right away. Its timer line is drawn by CSS from --undo-ms.
    const UNDO_MS = 5000;
    let undoing = null;        // { owner, onUndo, onCommit, timer } the delete that is currently undoable

    function showUndo(owner, message, onUndo, onCommit) {
        settleUndo(true);                                  // commit whatever was still undoable
        undoing = { owner, onUndo, onCommit, timer: setTimeout(() => settleUndo(true), UNDO_MS) };
        clearTimeout(noticeTimer);
        toast.classList.remove('notice');                  // bring the Undo button back
        $('toastMessage').textContent = message;
        toast.style.setProperty('--undo-ms', UNDO_MS + 'ms');
        toast.classList.remove('active');
        void toast.offsetWidth;                            // restart the timer line from full
        toast.classList.add('active');
    }

    // commit = true: the window closed (or a newer delete started); false: the person pressed Undo.
    // owner (optional): only settle if the current undo belongs to it.
    function settleUndo(commit, owner) {
        if (!undoing || (owner && undoing.owner !== owner)) return;
        const { onUndo, onCommit, timer } = undoing;
        clearTimeout(timer);
        undoing = null;
        toast.classList.remove('active');
        return commit ? onCommit() : onUndo();
    }
    window.undoToast = { show: showUndo, settle: settleUndo };

    // Plain confirmation ("Task added!"): same toast and timer line, no Undo button.
    // It never replaces an open undo window, since that one is time-sensitive.
    const NOTICE_MS = 2500;
    let noticeTimer = null;
    function showNotice(message) {
        if (undoing) return;
        clearTimeout(noticeTimer);
        $('toastMessage').textContent = message;
        toast.style.setProperty('--undo-ms', NOTICE_MS + 'ms');
        toast.classList.add('notice');
        toast.classList.remove('active');
        void toast.offsetWidth;                            // restart the timer line from full
        toast.classList.add('active');
        noticeTimer = setTimeout(() => toast.classList.remove('active'), NOTICE_MS);
    }

    function removeTask(task) {
        settleUndo(true);                                  // commits an earlier task or list delete
        pending = { task, index: tasks.indexOf(task) };
        tasks.splice(pending.index, 1);
        render();
        showUndo('task', `"${task.name}" deleted.`, undoDelete, commitDelete);
    }

    function undoDelete() {
        if (!pending) return;
        tasks.splice(pending.index, 0, pending.task);
        pending = null;
        render();
    }

    async function commitDelete() {
        if (!pending) return;
        const { task } = pending;
        pending = null;
        try {
            const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE', keepalive: true });
            if (!res.ok) throw new Error('delete failed');
        } catch (err) {
            tasks.push(task);
            render();
            alert('Failed to delete task. It has been restored.');
        }
    }

    $('toastUndoBtn').addEventListener('click', () => settleUndo(false));

    window.addEventListener('pagehide', () => { if (pending) commitDelete(); });
    window.addEventListener('pageshow', e => { if (e.persisted) window.location.reload(); });

    // ---- Add task (right-hand panel) ----
    $('taskDueDate').addEventListener('click', e => e.target.showPicker?.());

    taskForm.addEventListener('submit', async e => {
        e.preventDefault();
        formMsg.textContent = '';
        const body = Object.fromEntries(new FormData(taskForm));
        body.name = body.name.trim();
        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not add the task.');
            tasks.push(data);
            render();
            taskForm.reset();
            $('taskName').focus();
            showNotice('Task added!');
        } catch (err) {
            formMsg.textContent = err.message;
        }
    });

    // ---- Load tasks (also called by lists.js when switching lists) ----
    async function loadTasks() {
        if (pending) await settleUndo(true, 'task');   // never carry an undoable task delete into another list
        const seq = ++loadSeq;
        try {
            const res = await fetch('/api/tasks');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (seq !== loadSeq) return;
            tasks = data;
            editingId = null;
            render();
        } catch (err) {
            console.error('Error fetching tasks:', err);
        }
    }

    window.reloadTasks = loadTasks;
    loadView();        // restore saved filters + sorts
    updateToolbar();   // paint the pills now instead of waiting for the task fetch
    loadTasks();
});