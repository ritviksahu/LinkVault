import React, { useState } from 'react';
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

  const handleUpload = async () => {
    setLoading(true);
    const formData = new FormData();
    formData.append('type', mode);
    formData.append('expiryMinutes', expiry);
    if (mode === 'text') formData.append('text', text);
    else {
       if (!file) return alert('Select file');
       formData.append('file', file);
    }

    try {
// const res = await axios.post('http://localhost:5001/api/upload', formData, {
//   headers: { 'Content-Type': 'multipart/form-data' }
// });
      const res = await axios.post('http://localhost:5001/api/upload', formData);
      setGeneratedLink(res.data.link);
    } catch (err) { alert('Upload failed'); } 
    finally { setLoading(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto bg-gray-800 p-8 rounded border border-gray-700">
      {!generatedLink ? (
        <>
          <div className="flex justify-center mb-6 space-x-4">
            <button onClick={() => setMode('text')} className={`px-4 py-2 rounded flex gap-2 ${mode === 'text' ? 'bg-blue-600' : 'bg-gray-700'}`}><FileText size={18} /> Text</button>
            <button onClick={() => setMode('file')} className={`px-4 py-2 rounded flex gap-2 ${mode === 'file' ? 'bg-blue-600' : 'bg-gray-700'}`}><Upload size={18} /> File</button>
          </div>
          <div className="mb-6">
            {mode === 'text' ? (
              <textarea className="w-full h-40 bg-gray-900 p-4 rounded border border-gray-600 text-white" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text..." />
            ) : (
              <div className="h-40 border-2 border-dashed border-gray-600 rounded flex flex-col items-center justify-center">
                <input type="file" onChange={(e) => setFile(e.target.files[0])} className="hidden" id="f" />
                <label htmlFor="f" className="cursor-pointer flex flex-col items-center text-gray-400"><Upload size={32} /><span>{file ? file.name : 'Select File'}</span></label>
              </div>
            )}
          </div>
          <div className="mb-6 flex gap-4 text-gray-300 items-center">
            <Clock size={18} /> Expiry:
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="bg-gray-900 border border-gray-600 rounded px-2 py-1">
              <option value="1">1 Min</option><option value="10">10 Mins</option><option value="60">1 Hour</option><option value="1440">24 Hours</option>
            </select>
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
          <button onClick={() => {setGeneratedLink(''); setFile(null); setText('')}} className="text-gray-400 underline">New Upload</button>
        </div>
      )}
    </div>
  );
};
export default UploadPage;