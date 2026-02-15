const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors'); 
const multer = require('multer'); 
const { v4: uuidv4 } = require('uuid'); 
const cron = require('node-cron'); 
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5001;
const AUTH_TOKEN_TTL_HOURS = parseInt(process.env.AUTH_TOKEN_TTL_HOURS || '168', 10);
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const DEFAULT_ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed'
];
const configuredTypes = (process.env.ALLOWED_FILE_TYPES || '').split(',').map((x) => x.trim()).filter(Boolean);
const ALLOWED_FILE_TYPES = new Set(configuredTypes.length > 0 ? configuredTypes : DEFAULT_ALLOWED_TYPES);

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {console.log(`[REQ] ${req.method} ${req.path}`);next();});

app.get('/api/health', (req, res) => {res.status(200).json({ ok: true, time: new Date().toISOString() });});

app.get('/api/config', (req, res) => {res.json({maxFileSizeMB: MAX_FILE_SIZE_MB,allowedFileTypes: Array.from(ALLOWED_FILE_TYPES)});});

console.log('--- DB CONFIG ---');
console.log(`User: ${process.env.DB_USER}`);
console.log(`Host: ${process.env.DB_HOST}`);
console.log(`Database: ${process.env.DB_NAME}\n`);

const pool = new Pool({ 
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('DATABASE CONNECTION FAILED:', err);
  } else {
    console.log('Database Connected Successfully!');
  }
});

const storage = multer.diskStorage({ 
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_FILE_TYPES.has(file.mimetype)) return cb(null, true);
    return cb(new Error(`File type not allowed: ${file.mimetype}`));
  }
});

const hashPassword = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });

const verifyPassword = async (plainPassword, salt, expectedHash) => {
  if (!salt || !expectedHash) return true;
  if (!plainPassword) return false;
  const passwordHash = await hashPassword(plainPassword, salt);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(passwordHash, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

const parseLimit = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const isLimited = (limitValue) => limitValue !== null && limitValue !== undefined;
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message, details) => {
  const err = new Error(message);
  err.status = status;
  err.details = details;
  return err;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const issueAuthToken = async (userId) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO auth_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt]
  );
  return token;
};

const requireAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) throw httpError(401, 'Authentication required');
  const token = authHeader.slice(7).trim();
  if (!token) throw httpError(401, 'Authentication required');

  const result = await pool.query(`
    SELECT u.id, u.email, t.token
    FROM auth_tokens t
    JOIN linkvault_users u ON u.id = t.user_id
    WHERE t.token = $1 AND t.expires_at > NOW()
    LIMIT 1
  `, [token]);
  if (result.rows.length === 0) throw httpError(401, 'Invalid or expired session');
  req.user = result.rows[0];
  next();
});

const ensureSchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkvault_users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES linkvault_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('text', 'file')),
      content_text TEXT,
      file_path TEXT,
      original_name TEXT,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS owner_id UUID`);
  await pool.query(`
    UPDATE uploads u
    SET owner_id = NULL
    WHERE owner_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM linkvault_users lu WHERE lu.id = u.owner_id
      )
  `);
  await pool.query(`ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_owner_id_fkey`);
  await pool.query(`
    ALTER TABLE uploads
    ADD CONSTRAINT uploads_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES linkvault_users(id) ON DELETE SET NULL
  `);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS password_salt TEXT`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS max_view_count INTEGER`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS current_view_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS max_download_count INTEGER`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS current_download_count INTEGER NOT NULL DEFAULT 0`);
};

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = await pool.query('SELECT id FROM linkvault_users WHERE email = $1 LIMIT 1', [email]);
  if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });

  const userId = uuidv4();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  await pool.query(
    'INSERT INTO linkvault_users (id, email, password_salt, password_hash) VALUES ($1, $2, $3, $4)',
    [userId, email, salt, hash]
  );
  const token = await issueAuthToken(userId);
  res.status(201).json({ token, user: { id: userId, email } });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const result = await pool.query(
    'SELECT id, email, password_salt, password_hash FROM linkvault_users WHERE email = $1 LIMIT 1',
    [email]
  );
  if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const user = result.rows[0];
  const valid = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = await issueAuthToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email } });
}));

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

app.post('/api/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM auth_tokens WHERE token = $1', [req.user.token]);
  res.json({ success: true });
}));

const validateUploadPayload = (req, res, next) => {
  upload.single('file')(req, res, (uploadErr) => {
    if (!uploadErr) return next();
    if (uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE') {
      return next(httpError(400, `File too large. Max allowed size is ${MAX_FILE_SIZE_MB}MB`));
    }
    return next(httpError(400, uploadErr.message || 'Invalid file upload'));
  });
};

app.post('/api/upload', requireAuth, validateUploadPayload, asyncHandler(async (req, res) => {
  console.log('Received Upload Request...');
  const { type, text, expiryMinutes, password, maxViews, maxDownloads } = req.body;
  const id = uuidv4(); 
  const duration = expiryMinutes ? parseInt(expiryMinutes) : 10; 
  const expiresAt = new Date(Date.now() + duration * 60000);
  const maxViewCount = parseLimit(maxViews);
  const maxDownloadCount = parseLimit(maxDownloads);

  console.log('1. Preparing Query...');
  let query = '', values = [];
  let passwordSalt = null;
  let passwordHash = null;

  if (password && password.trim().length > 0) {
    passwordSalt = crypto.randomBytes(16).toString('hex');
    passwordHash = await hashPassword(password.trim(), passwordSalt);
  }

  if (type === 'text') {
    query = `
      INSERT INTO uploads (
        id, type, content_text, expires_at, password_salt, password_hash, max_view_count, max_download_count, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    values = [id, 'text', text, expiresAt, passwordSalt, passwordHash, maxViewCount, maxDownloadCount, req.user.id];
  } else if (type === 'file' && req.file) {
    console.log('   File received:', req.file.originalname);
    query = `
      INSERT INTO uploads (
        id, type, file_path, original_name, expires_at, password_salt, password_hash, max_view_count, max_download_count, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    values = [id, 'file', req.file.path, req.file.originalname, expiresAt, passwordSalt, passwordHash, maxViewCount, maxDownloadCount, req.user.id];
  } else {
    return res.status(400).json({ error: 'Invalid upload type or missing file' });
  }

  console.log('2. Executing SQL Query...');
  await pool.query(query, values);
  console.log('3. Query Success!');
  
  const baseUrl = process.env.BASE_URL || req.headers.origin || 'http://localhost:5173';
  res.status(201).json({ 
    success: true, 
    link: `${baseUrl}/view/${id}`
  });
  console.log('Response sent to frontend');
}));

app.get('/api/my-links', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, type, original_name, expires_at, max_view_count, current_view_count, max_download_count, current_download_count
     FROM uploads
     WHERE owner_id = $1
     ORDER BY expires_at DESC`,
    [req.user.id]
  );
  res.json({ links: result.rows });
}));

app.delete('/api/uploads/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('SELECT id, owner_id, file_path FROM uploads WHERE id = $1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Link not found' });
  const row = result.rows[0];
  if (!row.owner_id || row.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  if (row.file_path && fs.existsSync(row.file_path)) {
    fs.unlinkSync(row.file_path);
  }
  await pool.query('DELETE FROM uploads WHERE id = $1', [id]);
  res.json({ success: true });
}));

app.get('/api/content/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('SELECT * FROM uploads WHERE id = $1', [id]);
  if (result.rows.length === 0) return res.status(403).json({ error: 'Access Denied' });
  const data = result.rows[0];
  if (new Date(data.expires_at) < new Date()) return res.status(403).json({ error: 'Link Expired' });
  if (isLimited(data.max_view_count) && data.current_view_count >= data.max_view_count) {
    return res.status(403).json({ error: 'View limit reached', code: 'VIEW_LIMIT_REACHED' });
  }

  const passwordFromRequest = req.headers['x-link-password'] || req.query.password || '';
  const isPasswordValid = await verifyPassword(passwordFromRequest, data.password_salt, data.password_hash);
  if (!isPasswordValid) {
    const code = passwordFromRequest ? 'INVALID_PASSWORD' : 'PASSWORD_REQUIRED';
    return res.status(401).json({ error: 'Password required or invalid', code });
  }

  await pool.query('UPDATE uploads SET current_view_count = current_view_count + 1 WHERE id = $1', [id]);

  if (data.type === 'file') {
    return res.json({
      type: 'file',
      filename: data.original_name,
      downloadUrl: `http://localhost:${port}/api/download/${id}`,
      remainingViews: isLimited(data.max_view_count) ? Math.max(data.max_view_count - ((data.current_view_count || 0) + 1), 0) : null,
      remainingDownloads: isLimited(data.max_download_count) ? Math.max(data.max_download_count - (data.current_download_count || 0), 0) : null,
      requiresPassword: Boolean(data.password_hash)
    });
  }
  return res.json({
    type: 'text',
    content: data.content_text,
    remainingViews: isLimited(data.max_view_count) ? Math.max(data.max_view_count - ((data.current_view_count || 0) + 1), 0) : null,
    remainingDownloads: isLimited(data.max_download_count) ? Math.max(data.max_download_count - (data.current_download_count || 0), 0) : null,
    requiresPassword: Boolean(data.password_hash)
  });
}));

app.get('/api/download/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('SELECT * FROM uploads WHERE id = $1', [id]);
  if (result.rows.length === 0) return res.status(403).send('Expired or Invalid');
  const fileData = result.rows[0];
  if (new Date(fileData.expires_at) < new Date()) return res.status(403).send('Expired or Invalid');
  if (fileData.type !== 'file') return res.status(400).send('Not a file link');
  if (isLimited(fileData.max_download_count) && fileData.current_download_count >= fileData.max_download_count) {
    return res.status(403).send('Download limit reached');
  }

  const passwordFromRequest = req.headers['x-link-password'] || req.query.password || '';
  const isPasswordValid = await verifyPassword(passwordFromRequest, fileData.password_salt, fileData.password_hash);
  if (!isPasswordValid) return res.status(401).send('Password required or invalid');

  await pool.query('UPDATE uploads SET current_download_count = current_download_count + 1 WHERE id = $1', [id]);
  res.download(fileData.file_path, fileData.original_name);
}));

cron.schedule('* * * * *', async () => {
  console.log('Cleanup Job: Checking for expired files...');
  
  const now = new Date();
  
  try {
    const result = await pool.query(
      "SELECT id, file_path, original_name FROM uploads WHERE expires_at < $1", 
      [now]
    );

    if (result.rows.length > 0) {
      console.log(`Found ${result.rows.length} expired items. Deleting...`);

      for (const row of result.rows) {
        if (row.file_path && fs.existsSync(row.file_path)) {
          fs.unlinkSync(row.file_path);
          console.log(`   Deleted file: ${row.original_name}`);
        } else if (row.file_path) {
          console.log(` File not found (already deleted?): ${row.original_name}`);
        }

        await pool.query('DELETE FROM uploads WHERE id = $1', [row.id]);
      }
      console.log('Cleanup complete.');
    } else {
      console.log('No expired files found.');
    }
  } catch (err) {
    console.error('Cleanup Error:', err);
  }
});

ensureSchema()
  .then(() => {
    console.log('Schema check complete');
    app.listen(port, () => {
      console.log(`Backend running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize schema:', err);
    process.exit(1);
  });

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500) {
    console.error('Unhandled error:', err);
  }
  res.status(status).json({
    error: err.message || 'Server error',
    details: status >= 500 && process.env.NODE_ENV !== 'production' ? err.stack : undefined
  });
});
