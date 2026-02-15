import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Download, Copy, AlertTriangle } from 'lucide-react';

const ViewPage = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchContent = useCallback(async (passwordOverride = '') => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`/api/content/${id}`, {
        headers: passwordOverride ? { 'x-link-password': passwordOverride } : {},
        timeout: 8000
      });
      setData(res.data);
      setRequiresPassword(false);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'PASSWORD_REQUIRED' || code === 'INVALID_PASSWORD') {
        setRequiresPassword(true);
        setError(code === 'INVALID_PASSWORD' ? 'Incorrect password' : '');
        setData(null);
      } else if (code === 'VIEW_LIMIT_REACHED') {
        setError('View limit reached');
      } else {
        setError(err?.response?.data?.error || err?.message || 'Access Denied or Expired');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  const handleDownload = () => {
    if (!data?.downloadUrl) return;
    const separator = data.downloadUrl.includes('?') ? '&' : '?';
    const downloadUrl = password ? `${data.downloadUrl}${separator}password=${encodeURIComponent(password)}` : data.downloadUrl;
    window.location.href = downloadUrl;
  };

  if (requiresPassword) {
    return (
      <div className="max-w-md mx-auto bg-gray-800 p-8 rounded border border-gray-700 mt-10">
        <h2 className="text-xl font-semibold mb-4 text-white">Protected Link</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white mb-4"
          placeholder="Enter password"
        />
        <button
          onClick={() => fetchContent(password)}
          className="w-full bg-blue-600 py-3 rounded font-bold text-white"
        >
          Unlock
        </button>
        {error ? <p className="text-red-400 mt-3 text-sm">{error}</p> : null}
      </div>
    );
  }
  if (error) return <div className="text-center mt-20 text-red-400 flex flex-col items-center"><AlertTriangle size={48} /><h2 className="text-xl font-bold mt-4">{error}</h2></div>;
  if (!data || loading) return <div className="text-center mt-20">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto bg-gray-800 p-8 rounded border border-gray-700 mt-10">
      <h2 className="text-xl font-semibold mb-6 border-b border-gray-700 pb-4">{data.type === 'text' ? 'Secure Text' : 'Secure File'}</h2>
      <div className="text-sm text-gray-400 mb-4">
        {data.remainingViews === null ? 'Views: Unlimited' : `Remaining views: ${data.remainingViews}`}
        {' | '}
        {data.remainingDownloads === null ? 'Downloads: Unlimited' : `Remaining downloads: ${data.remainingDownloads}`}
      </div>
      {data.type === 'text' ? (
        <div className="relative">
          <pre className="bg-gray-900 p-6 rounded whitespace-pre-wrap font-mono text-sm text-gray-300">{data.content}</pre>
          <button onClick={() => navigator.clipboard.writeText(data.content)} className="absolute top-2 right-2 p-2 bg-gray-700 rounded"><Copy size={16} /></button>
        </div>
      ) : (
        <div className="text-center py-10">
          <p className="mb-6 text-gray-300">File: <span className="text-blue-400 font-bold">{data.filename}</span></p>
          <button onClick={handleDownload} className="bg-blue-600 px-8 py-3 rounded font-bold text-white inline-flex gap-2"><Download /> Download</button>
        </div>
      )}
    </div>
  );
};
export default ViewPage;
