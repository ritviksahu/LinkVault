import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Upload, FileText, Clock, Copy, Check } from 'lucide-react';

const UploadPage = () => {
  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [expiry, setExpiry] = useState(10);
  const [generatedLink, setGeneratedLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken') || '');
  const [authEmail, setAuthEmail] = useState(() => localStorage.getItem('authEmail') || '');
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(10);
  const [allowedMimeTypes, setAllowedMimeTypes] = useState([]);
  const [myLinks, setMyLinks] = useState([]);

  const resetUploadState = () => {
    setMode('text');
    setText('');
    setFile(null);
    setExpiry(10);
    setGeneratedLink('');
    setPassword('');
    setMaxViews('');
    setMaxDownloads('');
    setCopied(false);
  };

  const allowedFileTypes = useMemo(() => {
    if (allowedMimeTypes.length === 0) return '.png,.jpg,.jpeg,.gif,.pdf,.txt,.zip';
    const mimeToExt = {
      'image/png': '.png',
      'image/jpeg': '.jpg,.jpeg',
      'image/gif': '.gif',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/zip': '.zip',
      'application/x-zip-compressed': '.zip'
    };
    return allowedMimeTypes.map((m) => mimeToExt[m]).filter(Boolean).join(',');
  }, [allowedMimeTypes]);

  useEffect(() => {
    axios.get('/api/config')
      .then((res) => {
        if (typeof res.data.maxFileSizeMB === 'number') setMaxFileSizeMB(res.data.maxFileSizeMB);
        if (Array.isArray(res.data.allowedFileTypes)) setAllowedMimeTypes(res.data.allowedFileTypes);
      })
      .catch(() => {});
  }, []);

  const loadMyLinks = async (token) => {
    if (!token) return;
    try {
      const res = await axios.get('/api/my-links', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000
      });
      setMyLinks(res.data.links || []);
    } catch {
      setMyLinks([]);
    }
  };

  const handleAuth = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(endpoint, { email, password: accountPassword }, { timeout: 8000 });
      localStorage.setItem('authToken', res.data.token);
      localStorage.setItem('authEmail', res.data.user.email);
      setAuthToken(res.data.token);
      setAuthEmail(res.data.user.email);
      loadMyLinks(res.data.token);
      setEmail('');
      setAccountPassword('');
    } catch (err) {
      setAuthError(err?.response?.data?.error || err?.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    try {
      await axios.post('/api/auth/logout', {}, {
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 8000
      });
    } catch {
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('authEmail');
    setAuthToken('');
    setAuthEmail('');
    setMyLinks([]);
    resetUploadState();
  };

  const handleUpload = async () => {
    if (!authToken) return alert('Please login first');
    setLoading(true);
    const formData = new FormData();
    formData.append('type', mode);
    formData.append('expiryMinutes', expiry);
    if (password.trim()) formData.append('password', password.trim());
    if (maxViews) formData.append('maxViews', maxViews);
    if (maxDownloads) formData.append('maxDownloads', maxDownloads);
    if (mode === 'text') formData.append('text', text);
    else {
       if (!file) {
         setLoading(false);
         return alert('Select file');
       }
       formData.append('file', file);
    }

    try {
      const res = await axios.post('/api/upload', formData, {
        timeout: 8000,
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setGeneratedLink(res.data.link);
      loadMyLinks(authToken);
    } catch (err) {
      const serverMessage = err?.response?.data?.details || err?.response?.data?.error;
      alert(serverMessage || err?.message || 'Upload failed');
    } 
    finally { setLoading(false); }
  };

  const deleteLink = async (id) => {
    if (!window.confirm('Delete this link permanently?')) return;
    try {
      await axios.delete(`/api/uploads/${id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 8000
      });
      setMyLinks((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      alert(err?.response?.data?.error || err?.message || 'Delete failed');
    }
  };

  useEffect(() => {
    if (authToken) loadMyLinks(authToken);
    else resetUploadState();
  }, [authToken]);

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto bg-gray-800 p-8 rounded border border-gray-700">
      {!authToken ? (
        <div className="mb-8 bg-gray-900 border border-gray-700 rounded p-4">
          <h2 className="text-xl font-semibold mb-3">{authMode === 'register' ? 'Create Account' : 'Login'}</h2>
          <div className="grid gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              placeholder="Email"
            />
            <input
              type="password"
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              placeholder="Password"
            />
            <button
              onClick={handleAuth}
              disabled={authLoading}
              className="bg-blue-600 py-2 rounded font-semibold"
            >
              {authLoading ? '...' : authMode === 'register' ? 'Register' : 'Login'}
            </button>
            <button
              onClick={() => setAuthMode((m) => (m === 'login' ? 'register' : 'login'))}
              className="text-sm underline text-gray-300"
            >
              {authMode === 'login' ? 'Need an account? Register' : 'Already have an account? Login'}
            </button>
            {authError ? <p className="text-red-400 text-sm">{authError}</p> : null}
          </div>
        </div>
      ) : (
        <div className="mb-6 flex items-center justify-between bg-gray-900 border border-gray-700 rounded p-3">
          <p className="text-sm text-gray-300">Logged in as <span className="text-white font-semibold">{authEmail}</span></p>
          <button onClick={logout} className="text-sm underline text-red-300">Logout</button>
        </div>
      )}

      {authToken ? (
        !generatedLink ? (
          <>
          <div className="flex justify-center mb-6 space-x-4">
            <button onClick={() => setMode('text')} className={`px-4 py-2 rounded flex gap-2 ${mode === 'text' ? 'bg-blue-600' : 'bg-gray-700'}`}><FileText size={18} /> Text</button>
            <button onClick={() => setMode('file')} className={`px-4 py-2 rounded flex gap-2 ${mode === 'file' ? 'bg-blue-600' : 'bg-gray-700'}`}><Upload size={18} /> File</button>
          </div>
          <div className="mb-6">
            {mode === 'text' ? (
              <textarea className="w-full h-40 bg-gray-900 p-4 rounded border border-gray-600 text-white" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text..." />
            ) : (
              <div className="h-40 border-2 border-dashed border-gray-600 rounded flex flex-col items-center justify-center text-center px-3">
                <input type="file" accept={allowedFileTypes} onChange={(e) => setFile(e.target.files[0])} className="hidden" id="f" />
                <label htmlFor="f" className="cursor-pointer flex flex-col items-center text-gray-400">
                  <Upload size={32} />
                  <span>{file ? file.name : 'Select File'}</span>
                  <span className="text-xs mt-2">Max size: {maxFileSizeMB}MB</span>
                  {allowedMimeTypes.length > 0 ? <span className="text-xs mt-1">Allowed: {allowedMimeTypes.join(', ')}</span> : null}
                </label>
              </div>
            )}
          </div>
          <div className="mb-6 flex gap-4 text-gray-300 items-center">
            <Clock size={18} /> Expiry:
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="bg-gray-900 border border-gray-600 rounded px-2 py-1">
              <option value="1">1 Min</option><option value="10">10 Mins</option><option value="60">1 Hour</option><option value="1440">24 Hours</option>
            </select>
          </div>
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              placeholder="Password (optional)"
            />
            <input
              type="number"
              min="1"
              value={maxViews}
              onChange={(e) => setMaxViews(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              placeholder="Max views (optional)"
            />
            <input
              type="number"
              min="1"
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              placeholder="Max downloads (optional)"
            />
          </div>
          <button onClick={handleUpload} disabled={loading} className="w-full bg-green-600 py-3 rounded font-bold">{loading ? '...' : 'Generate Link'}</button>
          </>
        ) : (
          <div className="text-center">
            <h2 className="text-xl text-green-400 mb-4">Link Ready!</h2>
            <div className="bg-gray-900 p-4 rounded border border-gray-600 flex justify-between mb-4">
              <span className="truncate text-gray-300">{generatedLink}</span>
              <button onClick={copyLink} className="ml-4 text-blue-400">{copied ? <Check /> : <Copy />}</button>
            </div>
            <button
              onClick={() => {
                setGeneratedLink('');
                setFile(null);
                setText('');
                setPassword('');
                setMaxViews('');
                setMaxDownloads('');
              }}
              className="text-gray-400 underline"
            >
              New Upload
            </button>
          </div>
        )
      ) : null}

      {authToken ? (
        <div className="mt-8 bg-gray-900 border border-gray-700 rounded p-4">
          <h3 className="text-lg font-semibold mb-3">My Links</h3>
          {myLinks.length === 0 ? (
            <p className="text-sm text-gray-400">No links yet.</p>
          ) : (
            <div className="space-y-3">
              {myLinks.map((link) => (
                <div key={link.id} className="bg-gray-800 border border-gray-700 rounded p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{`${window.location.origin}/view/${link.id}`}</p>
                    {link.type === 'file' && link.original_name ? (
                      <p className="text-xs text-gray-300 truncate">File: {link.original_name}</p>
                    ) : null}
                    <p className="text-xs text-gray-400">Expires: {new Date(link.expires_at).toLocaleString()}</p>
                  </div>
                  <button onClick={() => deleteLink(link.id)} className="text-sm text-red-300 underline whitespace-nowrap">Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
export default UploadPage;
