const taskList = document.getElementById('taskList');
let currentTasks = [];

// Popup elements (reused from home.js task popup)
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

let editingTaskId = null; // task currently open in the popup for editing

// ---- Sorting ----
// Only Date Created and Due Date are sortable. Tasks without a due date
// are always pushed to the end, regardless of sort direction.
let activeSortField = null;   // 'date_created' | 'due_date' | null
let sortDirection = null;     // 'asc' | 'desc' | null

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

  getSortedTasks(currentTasks).forEach(task => {
    const li = document.createElement('li');
    li.dataset.id = task.id;

    const priority = task.priority || 'Low';

    li.innerHTML = `
      <button class="editBtn" aria-label="Edit ${escapeHtml(task.name)}">&#9998;</button>
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

    // Edit button opens the task popup pre-filled with this task's data
    li.querySelector('.editBtn').addEventListener('click', () => openEditPopup(task));
    taskList.appendChild(li);
  });
}

function openEditPopup(task) {
  editingTaskId = task.id;

  taskNameInput.value = task.name || '';
  taskPriorityInput.value = task.priority || 'Medium';
  taskTagInput.value = task.tag || 'Personal';
  taskDueDateInput.value = task.due_date || '';

  taskPopup.removeAttribute('hidden');
}

// trigger browser date picker when clicking anywhere on date input
taskDueDateInput?.addEventListener('click', () => {
  if (typeof taskDueDateInput.showPicker === 'function') {
    taskDueDateInput.showPicker();
  }
});

// close popup
closePopupBtn?.addEventListener('click', () => {
  taskPopup.setAttribute('hidden', 'true');
  editingTaskId = null;
});

// submit edits to Flask API
taskForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (editingTaskId === null) return;

  const updatedTask = {
    name: taskNameInput.value.trim(),
    priority: taskPriorityInput.value,
    tag: taskTagInput.value,
    due_date: taskDueDateInput ? taskDueDateInput.value : ''
  };

  try {
    const res = await fetch(`/api/tasks/${editingTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedTask)
    });

    if (res.ok) {
      const savedTask = await res.json();
      const index = currentTasks.findIndex(t => t.id === editingTaskId);
      if (index !== -1) {
        currentTasks[index] = savedTask;
      }
      renderTasks();
      taskPopup.setAttribute('hidden', 'true');
      editingTaskId = null;
      showSuccessPopup('Task updated successfully!');
    }
  } catch (err) {
    console.error('Error updating task:', err);
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