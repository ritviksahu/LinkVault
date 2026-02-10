import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Download, Copy, AlertTriangle } from 'lucide-react';

const ViewPage = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`http://localhost:5001/api/content/${id}`)
      .then(res => setData(res.data))
      .catch(err => setError('Access Denied or Expired'));
  }, [id]);

  if (error) return <div className="text-center mt-20 text-red-400 flex flex-col items-center"><AlertTriangle size={48} /><h2 className="text-xl font-bold mt-4">{error}</h2></div>;
  if (!data) return <div className="text-center mt-20">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto bg-gray-800 p-8 rounded border border-gray-700 mt-10">
      <h2 className="text-xl font-semibold mb-6 border-b border-gray-700 pb-4">{data.type === 'text' ? 'Secure Text' : 'Secure File'}</h2>
      {data.type === 'text' ? (
        <div className="relative">
          <pre className="bg-gray-900 p-6 rounded whitespace-pre-wrap font-mono text-sm text-gray-300">{data.content}</pre>
          <button onClick={() => navigator.clipboard.writeText(data.content)} className="absolute top-2 right-2 p-2 bg-gray-700 rounded"><Copy size={16} /></button>
        </div>
      ) : (
        <div className="text-center py-10">
          <p className="mb-6 text-gray-300">File: <span className="text-blue-400 font-bold">{data.filename}</span></p>
          <a href={data.downloadUrl} className="bg-blue-600 px-8 py-3 rounded font-bold text-white inline-flex gap-2"><Download /> Download</a>
        </div>
      )}
    </div>
  );
};
export default ViewPage;