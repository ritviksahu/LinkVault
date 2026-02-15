# LinkVault

LinkVault is a secure, full-stack link sharing platform where authenticated users can upload text or files and generate shareable links with configurable controls. Each link can be protected with a custom password, limited by maximum views/downloads, and automatically expires after a chosen duration. The system enforces file upload restrictions through MIME type validation and file-size limits, supports owner-based link management (including “My Links” and owner-only delete), and runs a background cleanup job to remove expired records and stored files.

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm
- PostgreSQL 13+

### 1. Clone and install dependencies
```bash
git clone https://github.com/ritviksahu/LinkVault.git
cd LinkVault
```

Install backend dependencies:
```bash
cd backend
npm install
```

Install frontend dependencies:
```bash
cd ../frontend
npm install
```

### 2. Create database
```sql
CREATE DATABASE linkvault;
```

The backend initializes/migrates required tables on startup.

### 3. Run backend
```bash
cd backend
lsof -ti :5001 | xargs kill -9 #kill the port if already running in background
node server.js
```

### 4. Run frontend
Open a new terminal:
```bash
cd frontend
lsof -ti :3000 | xargs kill -9 #kill the port if already running in background
npm run dev
```

Open `http://localhost:3000`.

### 5. Health check
```bash
curl -i http://127.0.0.1:5001/api/health
```

## API Overview

Base URL: `http://127.0.0.1:5001`

### Public routes
- `GET /api/health`
  - Liveness check.
- `GET /api/config`
  - Returns upload rules (`maxFileSizeMB`, allowed MIME types).
- `GET /api/content/:id`
  - Fetch text/file metadata by share link, enforces expiry/password/view limit.
- `GET /api/download/:id`
  - Downloads file by share link, enforces expiry/password/download limit.

### Authentication routes
- `POST /api/auth/register`
  - Body: `{ "email": "...", "password": "..." }`
  - Creates account and returns session token.
- `POST /api/auth/login`
  - Body: `{ "email": "...", "password": "..." }`
  - Returns session token.
- `GET /api/auth/me`
  - Header: `Authorization: Bearer <token>`
  - Returns authenticated user.
- `POST /api/auth/logout`
  - Header: `Authorization: Bearer <token>`
  - Invalidates current session token.

### Auth-protected link management routes
- `POST /api/upload`
  - Header: `Authorization: Bearer <token>`
  - Content type: `multipart/form-data`
  - Fields: `type`, `text|file`, `expiryMinutes`, `password`, `maxViews`, `maxDownloads`
  - Returns generated share link.
- `GET /api/my-links`
  - Header: `Authorization: Bearer <token>`
  - Returns only links owned by current user.
- `DELETE /api/uploads/:id`
  - Header: `Authorization: Bearer <token>`
  - Owner-only delete for a specific upload.

## Design Decisions

- Express + PostgreSQL keeps backend implementation simple and explicit.
- `multer` disk storage is used for files to avoid external object storage dependencies.
- Link metadata is in PostgreSQL, Metadata is stored in `backend/uploads`
- Link passwords are salted and hashed using `crypto.scrypt`.
- View/download limits are enforced server-side with DB counters.
- Expiry is enforced in two places:
  - Request-time access checks.
  - Scheduled cleanup job (cron every minute).
- Authentication uses DB-backed bearer tokens (`auth_tokens`) for simple session invalidation.

## Assumptions and Limitations

### Assumptions
- Frontend and backend run on the same machine in local development.
- PostgreSQL is reachable at `127.0.0.1:5432`.

### Limitations
- One-time view links are not implemented yet. (Because we have implemented Maximum download/view count)
- Shared link access (`/view/:id`) is intentionally link-based and not owner-login-gated.
- Files are stored on local disk.
- No antivirus/content scanning is included.

## Data flow diagram from the user upload to DB storage

![High-Level Architecture and Data Flow](docs/diagram.png)