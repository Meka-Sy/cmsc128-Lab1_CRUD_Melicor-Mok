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
- Collaborative lists shared by multiple users

---

## Tech Stack

- **HTML / CSS / JavaScript** makes up the frontend, without a framework or build step.
- **Flask** serves the pages, handles the REST API routes, and connects to the database with minimal setup.
- **SQLite** is a file-based database that needs no separate server and is created automatically on first launch.
- **Flask-Login** handles authentication and sessions (signed-cookie sessions), with **Werkzeug** salted password hashing.

This stack was picked because it's small, self-contained, and needs no external services.

---

## Feature Merge & Conflict Resolution

The current version merges the CRUD and account features from **working-branch** and **act2-accounts**, and the collaborative list features from the **feat/collab-list** branch.

- **Conflict Resolution:** Merge conflicts in `app.py` were resolved by combining the `task_scope()` relational UBAC checks with the soft-delete (`deleted_at IS NULL`) SQL queries.
- **Schema Integration:** The database schema was migrated to include a `list_id` column in the `tasks` table, retroactively linking tasks to the new collaborative lists architecture.

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
| `users`        | `id`, `email` (unique), `display_name` (unique, case-insensitive via `NOCASE` index), `password_hash`            |
| `lists`        | `id`, `owner_id` (FK -> `users`, `ON DELETE CASCADE`),`name`                                                     |
| `list_members` | `list_id`(FK -> `lists`,`ON DELETE CASCADE`), `user_id`(FK -> `users`,`ON DELETE CASCADE`); PK`(list_id,user_id)`|
| `tasks`        | `id`, `user_id`(FK->`users`,`ON DELETE CASCADE`),`list_id`(FK -> `lists`, `ON DELETE CASCADE`, nullable ---`NULL`= personal task) `name`, `priority`, `tag`, `date_created`, `due_date`, `deleted_at`, `done` (`CHECK` in `0,1`, default `0`                 |
| `reset_tokens` | `id`, `user_id` (FK to `users`, `ON DELETE CASCADE`), `token_hash` (unique), `expires_at` (ISO-8601 UTC), `used`(default `0` |

---

## REST API Endpoints

Every endpoint under `/api/` is a JSON API requiring a logged-in session (`401 Authentication required` otherwise). To prevent **Insecure Direct Object References (IDOR)**, the backend prepends ownership filters using `task_scope(conn)` before executing database changes.

| Method   | Endpoint                 | What it does & How ownership is checked                                |
| -------- | ------------------------ | ---------------------------------------------------------------------- |
| `GET`    | `/api/tasks`             | Retrieves tasks filtered by `list_id = ?` or `user_id = ?`             |
| `POST`   | `/api/tasks`             | Creates task safely assigned to `current_user.id` and active list      |
| `PUT`    | `/api/tasks/<id>`        | Updates task *only* if `id` matches active `task_scope`                |
| `DELETE` | `/api/tasks/<id>`        | Soft-deletes task *only* if `id` matches active `task_scope`           |
| `PATCH`  | `/api/tasks/<id>/toggle` | Toggles done status *only* if `id` matches active `task_scope`         |
| `GET`    | `/api/lists`             | Gets lists where `current_user.id` exists in `list_members`            |

---

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
# To-Do List App

A multi-user to-do list with personal tasks, shared (collaborative) lists, a stats dashboard, and email-based password recovery.

## 1. Stack and what was refactored

| Layer | Choice |
|---|---|
| Backend | **Python 3 + Flask** (blueprints, Flask-Login for sessions) |
| Database | **PostgreSQL** (via `psycopg2` connection pool) |
| Frontend | Server-rendered Jinja templates + vanilla JavaScript (`frontend/html`, `frontend/js`, `frontend/css`) |
| Hosting | Render (web service + managed Postgres), served by Gunicorn |

### Refactor / optimization summary

- **SQLite → PostgreSQL.** Needed for hosted deployment: Render's filesystem is ephemeral, so a file-based database loses data on redeploy. Postgres also enables `FILTER` aggregates and `generate_series` used by the stats endpoint, case-insensitive unique display names (`LOWER()` index), and `TIMESTAMPTZ` dates.
- **Connection pooling and timeouts** (`db.py`): one `ThreadedConnectionPool` per process with `connect_timeout`, `statement_timeout` and `lock_timeout`, so a hung query cannot exhaust the pool. Connections are rolled back before being returned, and discarded if the rollback fails. Render's `postgres://` URL scheme is rewritten for psycopg2.
- **Idempotent schema** (`schema.sql`): every statement uses `IF NOT EXISTS`, so it runs safely at each startup. Indexes cover the queries the app actually runs.
- **Security hardening:**
  - Passwords are hashed (Werkzeug); login uses a dummy hash to reduce timing-based user enumeration.
  - Reset tokens are random, expire after 15 minutes, are single-use, and only their SHA-256 hash is stored.
  - `/forgot` returns the same message whether or not the email exists.
  - `SECRET_KEY` is mandatory in production (app refuses to start without it).
  - Secure, HTTPOnly, SameSite=Lax session cookies; open-redirect protection on `?next=`.
  - Security headers on every response (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS over HTTPS) and `Cache-Control: no-store` on authenticated pages.
  - Logout is POST-only, with a confirmation dialog.
- **Deployment readiness:** `ProxyFix` so generated links use `https://` behind Render's proxy, a `/healthz` endpoint that checks the database, structured logging instead of `print()`, and JSON error responses for `/api/` routes with no stack traces leaked.
- **Data model:** soft-delete for tasks (`deleted_at`) with an undo toast on the frontend; every task query is scoped to either the user's personal tasks or a list they are a member of, so users cannot read or modify other people's tasks.

## 2. Run locally

### Prerequisites

- Python 3.10+
- PostgreSQL 13+ running locally (or any reachable Postgres instance)
- `git`

### Setup

```bash
# 1. Clone and enter the repo
git clone <YOUR_REPO_URL>
cd <YOUR_REPO_FOLDER>

# 2. Create a virtual environment and install dependencies
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. Create an empty database
createdb todo_app                  # or: psql -c "CREATE DATABASE todo_app;"
```

Create a `.env` file in the project root (same folder as `app.py`):

```env
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/todo_app
SECRET_KEY=replace-with-a-long-random-string
# Optional: only needed to actually send password-reset emails (Gmail app password)
SMTP_EMAIL=you@gmail.com
SMTP_PASSWORD=your-app-password
# Optional: connection pool size (defaults: min 1, max 5)
# DB_POOL_MAX=5
```

Generate a key with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Start the app

```bash
python app.py
```

Open <http://127.0.0.1:5000>. Tables are created automatically on first start from `schema.sql`; no manual migration is needed. Register an account to begin.

Notes:

- If `SECRET_KEY` is missing in development, an ephemeral key is generated (sessions reset on every restart).
- If SMTP is not configured and the app runs in debug mode, the password-reset link is written to the console log instead of being emailed.

### Run like production (optional)

```bash
gunicorn app:app --workers 2 --timeout 60
```

## 3. Access the deployed app

- **Live URL:** `https://<YOUR-SERVICE-NAME>.onrender.com`  <!-- replace with your Render URL -->
- **Health check:** `https://<YOUR-SERVICE-NAME>.onrender.com/healthz` should return `{"status":"ok"}`.

**Instructor setup:** none. Open the URL in any browser and click **Register** to create an account (or use the demo account below). No installs, VPN, or same-network access required.

> Demo account (optional): `<demo-email>` / `<demo-password>`

> **Heads-up:** the app runs on Render's free tier, which spins the service down after inactivity. The first request after idle time can take 30-60 seconds to wake up; later requests are fast.

### Deploying your own copy

`render.yaml` is a Render Blueprint. Create a new Blueprint from the repo, then set `SMTP_EMAIL` and `SMTP_PASSWORD` in the dashboard (they are `sync: false`). `DATABASE_URL` is wired from the Render Postgres database, and `SECRET_KEY` is generated automatically.

## 4. API endpoints

All `/api/*` routes require an authenticated session cookie (log in via the web form at `/login` first) and return JSON. Unauthenticated calls return `401 {"error": "Authentication required"}`.

### Tasks

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasks` | List tasks in the active scope (personal or the selected shared list) |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/<id>` | Update name, priority, tag, due date |
| PATCH | `/api/tasks/<id>/toggle` | Toggle done / not done |
| DELETE | `/api/tasks/<id>` | Soft-delete a task |
| GET | `/api/stats` | Totals, completion rate, breakdown by priority/tag, tasks created in the last 7 days |

### Shared lists

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/lists` | Lists you belong to, plus the active list id |
| POST | `/api/lists` | Create a list (you become the owner) |
| PUT | `/api/lists/active` | Switch active list (`{"list_id": null}` = personal) |
| PATCH | `/api/lists/<id>` | Rename a list (owner only) |
| DELETE | `/api/lists/<id>` | Delete a list and its tasks (owner only) |
| GET | `/api/lists/<id>/members` | List members |
| POST | `/api/lists/<id>/members` | Add a member by email or display name (owner only) |

### Examples

Log in and keep the session cookie:

```bash
curl -c cookies.txt -X POST http://127.0.0.1:5000/login \
  -d "email=you@example.com" -d "password=yourpassword"
```

Create a task:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"Buy groceries","priority":"High","tag":"Home","due_date":"2026-12-01"}'
```

Response (`201`):

```json
{
  "id": 12,
  "name": "Buy groceries",
  "priority": "High",
  "tag": "Home",
  "date_created": "2026-11-25",
  "due_date": "2026-12-01",
  "done": 0
}
```

Get tasks, toggle one, and delete it:

```bash
curl -b cookies.txt http://127.0.0.1:5000/api/tasks
curl -b cookies.txt -X PATCH  http://127.0.0.1:5000/api/tasks/12/toggle     # {"id":12,"done":1}
curl -b cookies.txt -X DELETE http://127.0.0.1:5000/api/tasks/12            # {"status":"deleted","id":12}
```

Create a shared list and add a collaborator:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:5000/api/lists \
  -H "Content-Type: application/json" -d '{"name":"Team Project"}'
curl -b cookies.txt -X POST http://127.0.0.1:5000/api/lists/1/members \
  -H "Content-Type: application/json" -d '{"user":"friend@example.com"}'
```

Validation rules: `priority` must be `Low`, `Medium` or `High`; `name` is required. Errors are returned as `{"error": "<message>"}` with an appropriate status code (400, 401, 403, 404).

### Page / auth routes

`/` (home), `/stats`, `/editMode`, `/deleteMode`, `/register`, `/login`, `/logout` (POST), `/profile`, `/forgot`, `/reset/<token>`, `/healthz`.

## Project structure

```
app.py               Flask app, task + stats routes, error handlers, headers
authRoutes.py        Register, login, profile, logout, session config
authHelpers.py       Flask-Login setup, safe-redirect check
password_recovery.py Forgot/reset password flow
collabLists.py       Shared-list API
db.py                Postgres pool and schema bootstrap
schema.sql           Idempotent schema
render.yaml          Render deployment blueprint
frontend/            html templates, css, js, images
```

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
Home Page with Lists
<img width="960" height="415" alt="home_with_lists" src="https://github.com/user-attachments/assets/711910dc-ceb2-4e5b-8221-9d1edcee4704" />
Collaboration Home Page 
<img width="958" height="408" alt="collaborative" src="https://github.com/user-attachments/assets/57fa7402-21ba-41d3-9ebb-61b9081ad595" />
Collaboration Edit Page
<img width="956" height="407" alt="edit_collab" src="https://github.com/user-attachments/assets/cda78e99-971e-484a-99fe-eb3f048a2096" />
Collaboration Delete Page
<img width="960" height="410" alt="delete_collab" src="https://github.com/user-attachments/assets/db4c9350-f08f-491b-a84e-f4ed6dc5aa83" />

List

<img width="201" height="333" alt="list_with_group" src="https://github.com/user-attachments/assets/61708da6-d842-460c-8a52-cd55119a704e" />

Two Users in Collaboration
<img width="958" height="413" alt="two_users" src="https://github.com/user-attachments/assets/937ce9ec-26fa-49d5-b07f-3c4d9b21a77b" />
NEW CHANGES
<img width="960" height="438" alt="Screenshot 2026-11-25 233919" src="https://github.com/user-attachments/assets/c1600f7b-673f-4171-bb5f-eb21b89353b7" />

<img width="957" height="440" alt="Screenshot 2026-11-25 233942" src="https://github.com/user-attachments/assets/50efcc34-dee1-47ed-bdeb-889f451ddf31" />

<img width="959" height="441" alt="Screenshot 2026-11-25 233955" src="https://github.com/user-attachments/assets/9947482e-f57a-4002-89b9-b7ab33d671b7" />

<img width="960" height="437" alt="Screenshot 2026-11-25 234058" src="https://github.com/user-attachments/assets/2c7f5123-4169-4520-98c8-49d0e2135d90" />

<img width="960" height="437" alt="Screenshot 2026-11-25 234034" src="https://github.com/user-attachments/assets/819d3d54-20ae-48f1-9c93-4975170a30b3" />


<img width="959" height="439" alt="Screenshot 2026-11-25 234111" src="https://github.com/user-attachments/assets/48a20b38-ec35-4a01-a947-a886e8ee1214" />

