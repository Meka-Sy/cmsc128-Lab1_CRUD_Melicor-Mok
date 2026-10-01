# cmsc128-Lab1_CRUD_Melicor-Mok

# To-Do List Web App

A simple task manager built with HTML, CSS, JavaScript, Flask, and SQLite. It has three views: Home, Delete Mode, and Edit Mode, each with its own focus: browsing and completing tasks, removing tasks with an undo window, and editing task details. Side tabs on each page allow for sorting and filtering by task priority, creation date, tag, and due date.

Users register an account and log in, and each user sees only their own tasks. Accounts include a profile page and email-based password recovery.

---

## Implemented Features

- Create, read, update, and delete tasks (name, priority, tag, due date, date created)
- Done checkbox to mark tasks complete or incomplete
- Home, Delete Mode, and Edit Mode views
- Sorting and filtering by priority, creation date, tag, and due date
- Soft-delete support (`deleted_at` column); soft-deleted tasks are hidden from the home page and `GET /api/tasks`
- User registration, login, and logout
- Profile page to update email, display name, and password
- Password recovery through an emailed, single-use reset link
- Per-user task isolation: every task query is scoped to the logged-in user

---

## Tech Stack

- **HTML / CSS / JavaScript** makes up the frontend, without a framework or build step.
- **Flask** serves the pages, handles the REST API routes, and connects to the database with minimal setup.
- **SQLite** is a file-based database that needs no separate server and is created automatically on first launch.
- **Flask-Login** handles authentication and sessions (signed-cookie sessions), with **Werkzeug** salted password hashing.

This stack was picked because it's small, self-contained, and needs no external services.

---

## How to Run Locally

**Requirements:** Python 3.8+ and `pip`.

1. Install dependencies:

   ```bash
   pip install flask flask-login python-dotenv
   ```

2. Download or clone this repository and open it in your terminal.

3. Create a `.env` file in the same folder as `app.py`:

   ```
   SECRET_KEY=replace-with-a-long-random-string
   SMTP_EMAIL=your-email@gmail.com
   SMTP_PASSWORD=your-gmail-app-password
   ```

   - `SECRET_KEY` signs the session cookie. If it is missing, a random key is generated on every start, which logs all users out whenever the server restarts. Generate one with `python -c "import secrets; print(secrets.token_hex(32))"`.
   - `SMTP_EMAIL` and `SMTP_PASSWORD` are optional for local use. Without them, password reset links are printed to the server console instead of being emailed.

4. Navigate to the folder that contains app.py and run the file:

   ```bash
   python app.py
   ```

5. Open **http://127.0.0.1:5000** in your browser. You will be sent to the login page; register an account first.

The database (`database.db`) is created automatically on the first run. To reset, stop the server and delete `database.db` (this removes all users and tasks).

---

## Database Setup

No manual setup is needed. On startup, `db.init_app()` runs `init_db()`, which executes `schema.sql` (tables use `CREATE TABLE IF NOT EXISTS`, so existing data is kept) and then adds the `tasks.deleted_at` column if an older database lacks it. Foreign keys are enabled on every connection (`PRAGMA foreign_keys = ON`).

| Table          | Columns                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `users`        | `id`, `email` (unique), `display_name` (unique, case-insensitive), `password_hash`                               |
| `tasks`        | `id`, `user_id`, `name`, `priority`, `tag`, `date_created`, `due_date`, `deleted_at`, `done`                     |
| `reset_tokens` | `id`, `user_id` (FK to `users`, `ON DELETE CASCADE`), `token_hash` (unique), `expires_at` (ISO-8601 UTC), `used` |

---

## REST API Endpoints

Every endpoint under /api/ is a JSON API, and all responses, whether success or error, are JSON objects. All of them require a logged-in session; unauthenticated requests get `401 {"error": "Authentication required"}`.

| Method   | Endpoint                 | What it does                        |
| -------- | ------------------------ | ----------------------------------- |
| `GET`    | `/api/tasks`             | Get all of the current user's tasks |
| `POST`   | `/api/tasks`             | Create a task                       |
| `PUT`    | `/api/tasks/<id>`        | Update a task                       |
| `DELETE` | `/api/tasks/<id>`        | Delete a task                       |
| `PATCH`  | `/api/tasks/<id>/toggle` | Toggle the done checkbox            |

**Example: create a task**

```http
POST /api/tasks
Content-Type: application/json

{"name": "Buy groceries", "priority": "Low", "tag": "Personal", "due_date": "2026-10-15"}
```

```json
201 Created
{"id": 4, "name": "Buy groceries", "priority": "Low", "tag": "Personal",
 "date_created": "2026-10-01", "due_date": "2026-10-15"}
```

`name` is required (`400` if missing). `priority` defaults to `Low`, `tag` to `General`, and `due_date` is optional. A task that doesn't exist or belongs to another user returns `404 {"error": "Task not found"}`.

### Page and Authentication Routes

| Method     | Route                           | What it does                                  |
| ---------- | ------------------------------- | --------------------------------------------- |
| `GET`      | `/`, `/deleteMode`, `/editMode` | Home, Delete, and Edit views (login required) |
| `GET/POST` | `/register`                     | Create an account                             |
| `GET/POST` | `/login`                        | Log in                                        |
| `POST`     | `/logout`                       | Log out                                       |
| `GET/POST` | `/profile`                      | Update email, display name, password          |
| `GET/POST` | `/forgot`                       | Request a password reset link                 |
| `GET/POST` | `/reset/<token>`                | Set a new password from a reset link          |

Example database operations behind authentication:

```sql
-- Register
INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?);

-- Login lookup
SELECT * FROM users WHERE email = ?;

-- Load the user on each request (Flask-Login user_loader)
SELECT id, email, display_name FROM users WHERE id = ?;
```

---

## Session Mechanism

Sessions use **Flask-Login** on top of Flask's signed-cookie session.

- **Login:** the password is verified with `check_password_hash`. On success the session is cleared first (prevents session fixation), `login_user()` stores the user ID in the cookie, and the session is marked permanent.
- **Per-request identity:** Flask-Login's `user_loader` looks up the user by ID on each request and exposes it as `current_user`.
- **Cookie:** signed with `SECRET_KEY`, so it can't be forged. Set `HttpOnly` and `SameSite=Lax`, plus `Secure` (HTTPS only) when not in debug mode. Lifetime is 7 days.
- **Logout:** `POST /logout` only, so a stray link can't log a user out.
- **Protected routes:** `@login_required` redirects pages to `/login?next=...` and returns `401` JSON for `/api/` routes. It also sends `Cache-Control: no-store` so protected pages aren't shown from cache after logout.
- **Safe redirects:** `?next=` is only honored for same-site relative paths.
- **Login hardening:** a single generic "Invalid email or password" message, and a dummy hash check for unknown emails so timing doesn't reveal which emails are registered.
- **Passwords:** stored only as salted hashes; minimum 8 characters.

---

## Password Recovery

1. The user submits their email at `/forgot`. The app always shows the same message, whether or not the email is registered, so accounts can't be enumerated.
2. If the email exists, a random token is made with `secrets.token_urlsafe(32)`. Only its **SHA-256 hash** is stored in `reset_tokens`. Earlier unused tokens for that user are invalidated, so only one link is live at a time.
3. The token expires after **15 minutes**.
4. The link `/reset/<token>` is emailed via Gmail SMTP over SSL (port 465) using `SMTP_EMAIL` and `SMTP_PASSWORD` (use a Gmail App Password). If these aren't set, the link is printed to the server console.
5. Opening the link checks that the token exists, is unused, and hasn't expired; otherwise an invalid-link page (`400`) is shown. The user then enters a new password (8+ characters, must match confirmation).
6. The token is claimed with `UPDATE ... SET used = 1 WHERE id = ? AND used = 0` and the row count is checked, so a link can't be used twice. All of that user's remaining tokens are then marked used, and the user is sent to the login page.

---

### Screenshots of the Working App

Login Page
<img width="958" height="467" alt="login" src="https://github.com/user-attachments/assets/86f7c53d-7f2b-4a57-b272-b6c9c3a8d435" />
Signup Page
<img width="959" height="467" alt="signup" src="https://github.com/user-attachments/assets/cacf939b-1587-4ee9-923c-99dcf5c8e413" />
Profile Page
<img width="959" height="470" alt="profile" src="https://github.com/user-attachments/assets/4d7a2a65-4d57-4c55-858b-7a452d28cb1a" />
<img width="959" height="468" alt="profile2" src="https://github.com/user-attachments/assets/3d98cb69-5ea8-476a-9806-64bfbffae052" />
Forgot Password
<img width="955" height="451" alt="forgot" src="https://github.com/user-attachments/assets/5c82cfd7-9c08-4578-a36f-5d2d644e64b9" />
Home Page
<img width="873" height="890" alt="c2d7890a-363a-4f41-84c7-9496b4fb7a17" src="https://github.com/user-attachments/assets/bda65a7b-7a9b-4d4b-99c3-21707dbefacc" />
Edit Page
<img width="873" height="861" alt="Screenshot 2026-09-10 234207" src="https://github.com/user-attachments/assets/fdc49f68-0d32-4879-8dd9-a5e4035d7e7a" />
Delete Page
<img width="906" height="873" alt="Screenshot 2026-09-10 234106" src="https://github.com/user-attachments/assets/222a7f0e-572a-4f51-8a01-def15c72e426" />
