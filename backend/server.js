const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors'); 
const multer = require('multer'); 
const { v4: uuidv4 } = require('uuid'); 
const cron = require('node-cron'); 
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

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

app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('Received Upload Request...');
  const { type, text, expiryMinutes } = req.body;
  const id = uuidv4(); 
  const duration = expiryMinutes ? parseInt(expiryMinutes) : 10; 
  const expiresAt = new Date(Date.now() + duration * 60000);

  try {
    console.log('1. Preparing Query...');
    let query = '', values = [];

    if (type === 'text') {
      query = 'INSERT INTO uploads (id, type, content_text, expires_at) VALUES ($1, $2, $3, $4)';
      values = [id, 'text', text, expiresAt];
    } else if (type === 'file' && req.file) {
      console.log('   File received:', req.file.originalname);
      query = 'INSERT INTO uploads (id, type, file_path, original_name, expires_at) VALUES ($1, $2, $3, $4, $5)';
      values = [id, 'file', req.file.path, req.file.originalname, expiresAt];
    } else {
      console.log('❌ Invalid input');
      return res.status(400).json({ error: 'Invalid upload type or missing file' });
    }

    console.log('2. Executing SQL Query...');
    await pool.query(query, values);
    console.log('3. Query Success!');
    
    res.status(201).json({ 
      success: true, 
      link: `${process.env.BASE_URL}/view/${id}`
    });
    console.log('✅ Response sent to frontend');

  } catch (err) { 
    console.error('❌ SERVER ERROR:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/content/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM uploads WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(403).json({ error: 'Access Denied' });
    const data = result.rows[0];
    if (new Date(data.expires_at) < new Date()) return res.status(403).json({ error: 'Link Expired' });

    if (data.type === 'file') {
      res.json({ type: 'file', filename: data.original_name, downloadUrl: `http://localhost:${port}/api/download/${id}` });
    } else {
      res.json({ type: 'text', content: data.content_text });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/download/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM uploads WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(403).send('Expired or Invalid');
    const fileData = result.rows[0];
    res.download(fileData.file_path, fileData.original_name);
  } catch (err) {
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

app.listen(port, () => {
  console.log(`🚀 Backend running on port ${port}`);
});