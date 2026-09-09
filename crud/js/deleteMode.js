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

const UNDO_WINDOW_MS = 5000;

let pendingTaskId = null;           // task selected in the confirm popup, not yet removed
let pendingDeletion = null;         // { task, index, timeoutId } — optimistically removed, awaiting finalize/undo

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

    // Minus button opens the confirm popup instead of deleting immediately
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