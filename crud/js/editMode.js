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

let editingTaskId = null; // task currently open in the popup for editing

async function loadTasks() {
  const res = await fetch('/api/tasks');
  currentTasks = await res.json();
  renderTasks();
}

function renderTasks() {
  taskList.innerHTML = ''; // clear before re-render

  currentTasks.forEach(task => {
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