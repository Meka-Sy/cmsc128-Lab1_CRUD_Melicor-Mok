document.addEventListener('DOMContentLoaded', () => {
    // home elements
    const taskList = document.getElementById('taskList');
    const emptyState = document.getElementById('emptyState');
    const addTaskBtn = document.getElementById('addTask');
    const editTaskBtn = document.getElementById('editTask');
    const deleteModeBtn = document.getElementById('deleteMode');


    // popup elements
    const taskPopup = document.getElementById('taskPopup');
    const closePopupBtn = document.getElementById('closePopup');
    const taskForm = document.getElementById('taskForm');
    const taskNameInput = document.getElementById('taskName');
    const taskPriorityInput = document.getElementById('taskPriorityLevel');
    const taskTagInput = document.getElementById('taskTag');
    const taskDueDateInput = document.getElementById('taskDueDate');

    // success popup elements
    const successOverlay = document.getElementById('successOverlay');
    const successText = document.getElementById('successText');
    const successOkBtn = document.getElementById('successOkBtn');
    const PRIORITY_RANK = { High: 3, Medium: 2, Low: 1 };
    const tagFilterSelect = document.getElementById('tagFilter');
    const priorityFilterSelect = document.getElementById('priorityFilter');
    tagFilterSelect?.addEventListener('change', () => {
        activeTagFilter = tagFilterSelect.value || null;
        renderTasks();
    });
    priorityFilterSelect?.addEventListener('change', () => {
        activePriorityFilter = priorityFilterSelect.value || null;
        renderTasks();
    });
    // ---- Filtering ----
    let activeTagFilter = null;      // e.g. 'Work', or null for "all"
    let activePriorityFilter = null; // 'High' | 'Medium' | 'Low' | null

    function showSuccessPopup(message) {
        successText.textContent = message;
        successOverlay.classList.add('active');
    }

    function hideSuccessPopup() {
        successOverlay.classList.remove('active');
    }

    successOkBtn?.addEventListener('click', hideSuccessPopup);

    successOverlay?.addEventListener('click', (e) => {
        if (e.target === successOverlay) hideSuccessPopup();
    });

    let tasks = []; 

    // ---- Sorting ----
    // Only Date Created and Due Date are sortable. Tasks without a due date
    // are always pushed to the end, regardless of sort direction.
    let activeSortField = null;   // 'date_created' | 'due_date' | null
    let sortDirection = null;     // 'asc' | 'desc' | null
    function getFilteredTasks(list) {
        return list.filter(task => {
            const tag = task.tag || 'General';
            const priority = task.priority || 'Low';
            if (activeTagFilter && tag !== activeTagFilter) return false;
            if (activePriorityFilter && priority !== activePriorityFilter) return false;
            return true;
        });
    }
    function getSortedTasks(list) {
        if (!activeSortField) return list;
        const sorted = [...list];

        sorted.sort((a, b) => {
            if (activeSortField === 'date_created') {
                const diff = new Date(a.date_created) - new Date(b.date_created);
                return sortDirection === 'desc' ? -diff : diff;
            }

            if (activeSortField === 'due_date') {
                const aTime = a.due_date ? new Date(a.due_date).getTime() : null;
                const bTime = b.due_date ? new Date(b.due_date).getTime() : null;
                if (aTime === null && bTime === null) return 0;
                if (aTime === null) return 1;
                if (bTime === null) return -1;
                const diff = aTime - bTime;
                return sortDirection === 'desc' ? -diff : diff;
            }
            if (activeSortField === 'priority') {
                const aRank = PRIORITY_RANK[a.priority] || 0;
                const bRank = PRIORITY_RANK[b.priority] || 0;
                const diff = aRank - bRank;
                return sortDirection === 'desc' ? -diff : diff;
            }
            if (activeSortField === 'tag') {
                const diff = (a.tag || '').localeCompare(b.tag || '');
                return sortDirection === 'desc' ? -diff : diff;
            }

            return 0;
        });

        return sorted;
    }

    function updateSortIndicators() {
        document.querySelectorAll('.sortArrowBtn').forEach(btn => {
            const isActive = activeSortField === btn.dataset.field && sortDirection === btn.dataset.dir;
            btn.classList.toggle('active', isActive);
            const icon = btn.querySelector('i');
            if (icon && btn.dataset.icon) {
                icon.className = 'bi bi-' + btn.dataset.icon + (isActive ? '-fill' : '');
            }
        });
        document.querySelectorAll('.sortTab').forEach(tab => {
            tab.setAttribute('aria-pressed', tab.dataset.field === activeSortField ? 'true' : 'false');
        });
    }

    function setSort(field, dir) {
        activeSortField = field;
        sortDirection = field ? dir : null;
        updateSortIndicators();
        renderTasks();
    }

    // Ascending/descending arrow buttons apply that field's sort
    document.querySelectorAll('.sortArrowBtn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setSort(btn.dataset.field, btn.dataset.dir);
        });
    });

    // Clicking the tab itself (not the arrows) turns sorting off
    document.querySelectorAll('.sortTab').forEach(tab => {
        tab.addEventListener('click', () => setSort(null, null));
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSort(null, null);
            }
        });
    });

    //undo toggle listener
    taskList.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('taskCheckbox')) return;

    const li = e.target.closest('.task-item');
    const taskId = li.dataset.id;

    const res = await fetch(`/api/tasks/${taskId}/toggle`, { method: 'PATCH' });
    const updated = await res.json();

    li.classList.toggle('completed', updated.done === 1);

    // keep local `tasks` array in sync too, so re-renders don't lose the state
    const t = tasks.find(t => t.id === taskId || t.id === Number(taskId));
    if (t) t.done = updated.done;
});
    // open popup
    addTaskBtn?.addEventListener('click', () => {
        taskForm.reset();
        taskPopup.removeAttribute('hidden');
    });

    // trigger browser date picker when clicking anywhere on date input
    taskDueDateInput?.addEventListener('click', () => {
        if (typeof taskDueDateInput.showPicker === 'function') {
            taskDueDateInput.showPicker();
        }
    });

    // close popup
    closePopupBtn?.addEventListener('click', () => {
        taskPopup.setAttribute('hidden', 'true');
    });

    // render tasks to screen
    function renderTasks() {
    taskList.innerHTML = '';
    const visibleTasks = getSortedTasks(getFilteredTasks(tasks));

    if (visibleTasks.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    visibleTasks.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item' + (task.done ? ' completed' : '');
        li.dataset.id = task.id;
        const priority = task.priority || 'Low';
        const tag = task.tag || 'General';
        li.innerHTML = `
            <input type="checkbox" class="taskCheckbox" ${task.done ? 'checked' : ''} />
            <div class="taskInfo">
                <span class="taskMeta">
                    <span class="taskDate">${new Date(task.date_created).toLocaleDateString()}</span>
                    <span class="taskTag">${escapeHtml(tag)}</span>
                    <span class="taskPriority priority-${priority.toLowerCase()}">${escapeHtml(priority)}</span>
                    ${task.due_date ? `<span class="dueDateGroup"><span class="dueDateLabel">Due Date:</span><span class="taskDueDate">${escapeHtml(task.due_date)}</span></span>` : ''}
                </span>
                <span class="taskName">${escapeHtml(task.name)}</span>
            </div>
        `;
        taskList.appendChild(li);
    });
}

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // fetch tasks from Flask API on load
    async function loadTasks() {
        try {
            const res = await fetch('/api/tasks');
            tasks = await res.json();
            renderTasks();
        } catch (err) {
            console.error('Error fetching tasks:', err);
        }
    }

    // submit form to Flask API
    taskForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const newTask = {
            name: taskNameInput.value.trim(),
            priority: taskPriorityInput.value,
            tag: taskTagInput.value,
            due_date: taskDueDateInput ? taskDueDateInput.value : ''
        };

        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTask)
            });

            if (res.ok) {
                const savedTask = await res.json();
                tasks.push(savedTask);
                renderTasks();
                taskPopup.setAttribute('hidden', 'true');
                showSuccessPopup('Task created successfully!');
            }
        } catch (err) {
            console.error('Error adding task:', err);
        }
    });

    deleteModeBtn?.addEventListener('click', () => {
        window.location.href = '/deleteMode';
    });

    editTaskBtn?.addEventListener('click', () => {
        window.location.href = '/editMode';
    });

    loadTasks();
});