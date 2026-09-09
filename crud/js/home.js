const deleteModeBtn = document.getElementById('deleteMode');
deleteModeBtn.addEventListener('click', () => {
  window.location.href = '/deleteMode';
});

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

    let tasks = []; //temp storage

    // open popup
    addTaskBtn?.addEventListener('click', () => {
        taskForm.reset();
        taskPopup.removeAttribute('hidden');
    });

    // close popup
    closePopupBtn?.addEventListener('click', () => {
        taskPopup.setAttribute('hidden', 'true');
    });

    // render tasks to screen
    function renderTasks() {
        taskList.innerHTML = '';

        if (tasks.length === 0) {
            emptyState.style.display = 'block';
            return;
        }
        emptyState.style.display = 'none';

        tasks.forEach(task => {
            const li = document.createElement('li');
            li.className = 'task-item';
            li.dataset.id = task.id;

            li.innerHTML = `
                <div class="task-info">
                    <span class="badge priority-${task.priority.toLowerCase()}">${task.priority}</span>
                    <span class="badge tag-${task.tag.toLowerCase()}">${task.tag}</span>
                    <p class="task-text">${task.title}</p>
                </div>
            `;

            taskList.appendChild(li);
        });
    }

    // submit form
    taskForm?.addEventListener('submit', (e) => {
        e.preventDefault();

        const newTask = {
            id: crypto.randomUUID(),
            title: taskNameInput.value.trim(),
            priority: taskPriorityInput.value,
            tag: taskTagInput.value
        };

        tasks.push(newTask);
        renderTasks();
        taskPopup.setAttribute('hidden', 'true');
    });

    // deletemode navigation
    deleteModeBtn?.addEventListener('click', () => {
        window.location.href = 'deleteMode.html';
    });


    renderTasks();
});