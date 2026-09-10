# cmsc128-Lab1_CRUD_Melicor-Mok

# To-Do List Web App

A simple task manager built with HTML, CSS, JavaScript, Flask, and SQLite. It has three views: Home, Delete Mode, and Edit Mode, each with its own focus: browsing and completing tasks, removing tasks with an undo window, and editing task details. Side tabs on each page allow for sorting and filtering by task priority, creation date, tag, and due date.

---

## Tech Stack

- **HTML / CSS / JavaScript** makes up the frontend, without a framework or build step.
- **Flask** serves the pages, handles the REST API routes, and connects to the database with minimal setup.
- **SQLite** is a file-based database that needs no separate server and is created automatically on first launch. 

This stack was picked because it's small, self-contained, and needs no external services.

---

## How to Run Locally

**Requirements:** Python 3.8+ and `pip`.

1. Install dependencies:

   ```bash
   pip install flask
   ```

2. Download or clone this repository and open it in your terminal.

3. Navigate to the folder that contains app.py and run the file:

   ```bash
   python app.py
   ```

4. Open **http://127.0.0.1:5000** in your browser.


The database (`database.db`) and sample tasks are created automatically on the first run. To reset, stop the server and delete `database.db`.

---

## REST API Endpoints

Every endpoint under /api/ is a JSON API, and all responses, whether success or error, are JSON objects.

| Method | Endpoint | What it does |
|---|---|---|
| `GET` | `/api/tasks` | Get all tasks |
| `POST` | `/api/tasks` | Create a task |
| `PUT` | `/api/tasks/<id>` | Update a task |
| `DELETE` | `/api/tasks/<id>` | Delete a task |
| `PATCH` | `/api/tasks/<id>/toggle` | Toggle the done checkbox |

---

### Screenshots of the Working App
Home Page
<img width="873" height="890" alt="c2d7890a-363a-4f41-84c7-9496b4fb7a17" src="https://github.com/user-attachments/assets/bda65a7b-7a9b-4d4b-99c3-21707dbefacc" />
Edit Page
<img width="873" height="861" alt="Screenshot 2026-09-10 234207" src="https://github.com/user-attachments/assets/fdc49f68-0d32-4879-8dd9-a5e4035d7e7a" />
Delete Page
<img width="906" height="873" alt="Screenshot 2026-09-10 234106" src="https://github.com/user-attachments/assets/222a7f0e-572a-4f51-8a01-def15c72e426" />
