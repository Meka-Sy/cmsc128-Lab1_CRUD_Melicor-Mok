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

    let tasks = []; 

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

        if (tasks.length === 0) {
            emptyState.style.display = 'block';
            return;
        }
        emptyState.style.display = 'none';

        tasks.forEach(task => {
            const li = document.createElement('li');
            li.className = 'task-item';
            li.dataset.id = task.id;

            const priority = task.priority || 'Low';
            const tag = task.tag || 'General';

            li.innerHTML = `
                <div class="task-info">
                    <span class="badge priority-${priority.toLowerCase()}">${priority}</span>
                    <span class="badge tag-${tag.toLowerCase()}">${tag}</span>
                    ${task.due_date ? `<span class="due-date">${task.due_date}</span>` : ''}
                    <p class="task-text">${task.name}</p>
                </div>
            `;

            taskList.appendChild(li);
        });
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
            }
        } catch (err) {
            console.error('Error adding task:', err);
        }
    });

    deleteModeBtn?.addEventListener('click', () => {
        window.location.href = '/deleteMode';
    });

    loadTasks();
});