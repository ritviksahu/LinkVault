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

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

console.log('--- DB CONFIG ---');
console.log(`User: ${process.env.DB_USER}`);
console.log(`Host: ${process.env.DB_HOST}`);
console.log(`Database: ${process.env.DB_NAME}`);
console.log('-----------------');

const pool = new Pool({ // PostgreSQL connection setup
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
    console.error('❌ DATABASE CONNECTION FAILED:', err);
  } else {
    console.log('✅ Database Connected Successfully!');
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
const upload = multer({ storage: storage }); 

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

const ensureSchema = async () => {
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
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS password_salt TEXT`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS max_view_count INTEGER`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS current_view_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS max_download_count INTEGER`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS current_download_count INTEGER NOT NULL DEFAULT 0`);
};

app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('Received Upload Request...');
  const { type, text, expiryMinutes, password, maxViews, maxDownloads } = req.body;
  const id = uuidv4(); 
  const duration = expiryMinutes ? parseInt(expiryMinutes) : 10; 
  const expiresAt = new Date(Date.now() + duration * 60000);
  const maxViewCount = parseLimit(maxViews);
  const maxDownloadCount = parseLimit(maxDownloads);

  try {
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
          id, type, content_text, expires_at, password_salt, password_hash, max_view_count, max_download_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      values = [id, 'text', text, expiresAt, passwordSalt, passwordHash, maxViewCount, maxDownloadCount];
    } else if (type === 'file' && req.file) {
      console.log('   File received:', req.file.originalname);
      query = `
        INSERT INTO uploads (
          id, type, file_path, original_name, expires_at, password_salt, password_hash, max_view_count, max_download_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      values = [id, 'file', req.file.path, req.file.originalname, expiresAt, passwordSalt, passwordHash, maxViewCount, maxDownloadCount];
    } else {
      console.log('❌ Invalid input');
      return res.status(400).json({ error: 'Invalid upload type or missing file' });
    }

    console.log('2. Executing SQL Query...');
    try {
      await pool.query(query, values);
    } catch (err) {
      // Backward-compatible fallback when DB is still on old schema.
      if (err.code === '42703') {
        console.log('⚠️ New columns not found. Falling back to legacy upload insert.');
        if (type === 'text') {
          await pool.query(
            'INSERT INTO uploads (id, type, content_text, expires_at) VALUES ($1, $2, $3, $4)',
            [id, 'text', text, expiresAt]
          );
        } else {
          await pool.query(
            'INSERT INTO uploads (id, type, file_path, original_name, expires_at) VALUES ($1, $2, $3, $4, $5)',
            [id, 'file', req.file.path, req.file.originalname, expiresAt]
          );
        }
      } else {
        throw err;
      }
    }
    console.log('3. Query Success!');
    
    const baseUrl = process.env.BASE_URL || req.headers.origin || 'http://localhost:5173';
    res.status(201).json({ 
      success: true, 
      link: `${baseUrl}/view/${id}`
    });
    console.log('✅ Response sent to frontend');

  } catch (err) { 
    console.error('❌ SERVER ERROR:', err);
    res.status(500).json({
      error: 'Upload failed',
      details: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
});

app.get('/api/content/:id', async (req, res) => {
  const { id } = req.params;
  try {
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
      res.json({
        type: 'file',
        filename: data.original_name,
        downloadUrl: `http://localhost:${port}/api/download/${id}`,
        remainingViews: isLimited(data.max_view_count) ? Math.max(data.max_view_count - ((data.current_view_count || 0) + 1), 0) : null,
        remainingDownloads: isLimited(data.max_download_count) ? Math.max(data.max_download_count - (data.current_download_count || 0), 0) : null,
        requiresPassword: Boolean(data.password_hash)
      });
    } else {
      res.json({
        type: 'text',
        content: data.content_text,
        remainingViews: isLimited(data.max_view_count) ? Math.max(data.max_view_count - ((data.current_view_count || 0) + 1), 0) : null,
        remainingDownloads: isLimited(data.max_download_count) ? Math.max(data.max_download_count - (data.current_download_count || 0), 0) : null,
        requiresPassword: Boolean(data.password_hash)
      });
    }
  } catch (err) {
    console.error('Content fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/download/:id', async (req, res) => {
  const { id } = req.params;
  try {
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
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Error');
  }
});

cron.schedule('* * * * *', async () => {
  console.log('🧹 Cleanup Job: Checking for expired files...');
  
  const now = new Date();
  
  try {
    // 1. Find all expired files
    const result = await pool.query(
      "SELECT id, file_path, original_name FROM uploads WHERE expires_at < $1", 
      [now]
    );

    if (result.rows.length > 0) {
      console.log(`🗑️  Found ${result.rows.length} expired items. Deleting...`);

      for (const row of result.rows) {
        // A. Delete the physical file (if it's a file type)
        if (row.file_path && fs.existsSync(row.file_path)) {
          fs.unlinkSync(row.file_path);
          console.log(`   ✅ Deleted file: ${row.original_name}`);
        } else if (row.file_path) {
          console.log(`   ⚠️ File not found (already deleted?): ${row.original_name}`);
        }

        // B. Delete the database record
        await pool.query('DELETE FROM uploads WHERE id = $1', [row.id]);
      }
      console.log('✨ Cleanup complete.');
    } else {
      console.log('👍 No expired files found.');
    }
  } catch (err) {
    console.error('❌ Cleanup Error:', err);
  }
});

ensureSchema()
  .then(() => {
    console.log('✅ Schema check complete');
    app.listen(port, () => {
      console.log(`🚀 Backend running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize schema:', err);
    process.exit(1);
  });
