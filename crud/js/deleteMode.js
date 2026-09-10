const taskList = document.getElementById('taskList');
let currentTasks = [];

// Popup elements
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmText = document.getElementById('confirmText');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// Toast elements
const undoToast = document.getElementById('undoToast');
const toastMessage = document.getElementById('toastMessage');
const toastUndoBtn = document.getElementById('toastUndoBtn');
const toastProgress = document.getElementById('toastProgress');
const PRIORITY_RANK = { High: 3, Medium: 2, Low: 1 };

const UNDO_WINDOW_MS = 5000;
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
let pendingTaskId = null;           // task selected in the confirm popup, not yet removed
let pendingDeletion = null;         // { task, index, timeoutId } — optimistically removed, awaiting finalize/undo

// ---- Sorting ----
// Only Date Created and Due Date are sortable. Tasks without a due date
// are always pushed to the end, regardless of sort direction.
let activeSortField = null;   // 'date_created' | 'due_date' | null
let sortDirection = null;     // 'asc' | 'desc' | null
let activeTagFilter = null;        // ADD THIS
let activePriorityFilter = null;   // ADD THIS
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

async function loadTasks() {
  const res = await fetch('/api/tasks');
  currentTasks = await res.json();
  renderTasks();
}
function renderTasks() {
  taskList.innerHTML = ''; // clear before re-render
  const visibleTasks = getSortedTasks(getFilteredTasks(currentTasks));

  if (visibleTasks.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  visibleTasks.forEach(task => {
    const li = document.createElement('li');
    li.dataset.id = task.id;
    const priority = task.priority || 'Low';

    li.innerHTML = `
      <button class="minusBtn" aria-label="Delete ${escapeHtml(task.name)}">-</button>
      <div class="taskInfo">
        <span class="taskMeta">
          <span class="taskDate">${new Date(task.date_created).toLocaleDateString()}</span>
          <span class="taskTag">${escapeHtml(task.tag)}</span>
          <span class="taskPriority priority-${priority.toLowerCase()}">${escapeHtml(priority)}</span>
          ${task.due_date ? `<span class="dueDateGroup"><span class="dueDateLabel">Due Date:</span><span class="taskDueDate">${escapeHtml(task.due_date)}</span></span>` : ''}
        </span>
        <span class="taskName">${escapeHtml(task.name)}</span>
      </div>
    `;

    li.querySelector('.minusBtn').addEventListener('click', () => openConfirmPopup(task));
    taskList.appendChild(li);
  });
}
function openConfirmPopup(task) {
  pendingTaskId = task.id;
  confirmText.innerHTML = `1 task selected.<br>Are you sure you want to delete "${escapeHtml(task.name)}"?`;
  openPopup(confirmOverlay);
}

// The real, non-recoverable delete call — only fires once the undo window closes
async function commitDelete(id) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Failed to delete task. It has been restored.');
    return false;
  }
  return true;
}

function openPopup(overlay) {
  overlay.classList.add('active');
}

function closePopup(overlay) {
  overlay.classList.remove('active');
}

// Confirm popup: user clicks "Delete", only stages the deletion, it does not call the API yet
confirmDeleteBtn.addEventListener('click', () => {
  if (pendingTaskId === null) return;

  const taskId = pendingTaskId;
  pendingTaskId = null;
  closePopup(confirmOverlay);

  stageDeletion(taskId);
});

function stageDeletion(taskId) {
  // If a previous deletion is still pending, finalize it immediately first
  if (pendingDeletion) {
    finalizeDeletion();
  }

  const index = currentTasks.findIndex(t => t.id === taskId);
  if (index === -1) return;

  const [task] = currentTasks.splice(index, 1);
  renderTasks(); // remove from the list right away

  pendingDeletion = {
    task,
    index,
    timeoutId: setTimeout(finalizeDeletion, UNDO_WINDOW_MS),
  };

  showToast(`"${task.name}" deleted.`);
}

async function finalizeDeletion() {
  if (!pendingDeletion) return;

  const { task, timeoutId } = pendingDeletion;
  clearTimeout(timeoutId);
  pendingDeletion = null;
  hideToast();

  const success = await commitDelete(task.id);

  if (!success) {
    // API call failed, put the task back since it was never actually deleted
    currentTasks.push(task);
    renderTasks();
  }
}

function undoDeletion() {
  if (!pendingDeletion) return;

  const { task, index, timeoutId } = pendingDeletion;
  clearTimeout(timeoutId);
  pendingDeletion = null;

  // Restore the task to, as close as possible to, its original position
  currentTasks.splice(index, 0, task);
  renderTasks();
  hideToast();
}

function showToast(message) {
  toastMessage.textContent = message;
  undoToast.classList.add('active');

  // Reset and (re)start the progress bar animation
  toastProgress.classList.remove('countdown');
  toastProgress.style.transform = 'scaleX(1)';
  // Force reflow so the transition re-triggers on repeated toasts
  void toastProgress.offsetWidth;
  toastProgress.classList.add('countdown');
  toastProgress.style.transitionDuration = `${UNDO_WINDOW_MS}ms`;
  toastProgress.style.transform = 'scaleX(0)';
}

function hideToast() {
  undoToast.classList.remove('active');
  toastProgress.classList.remove('countdown');
}

toastUndoBtn.addEventListener('click', undoDeletion);

// Close confirm popup on backdrop click
confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) {
    closePopup(confirmOverlay);
    pendingTaskId = null;
  }
});

// Close confirm popup on Escape; finalize any pending toast deletion immediately
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePopup(confirmOverlay);
    pendingTaskId = null;
  }
});


function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Back button, this would return to home page
document.querySelector('.backBtn').addEventListener('click', () => {
  window.location.href = '/';
});

loadTasks();