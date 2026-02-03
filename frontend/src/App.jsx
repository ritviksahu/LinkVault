import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import UploadPage from './components/UploadPage';
import ViewPage from './components/ViewPage';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-900 text-white font-sans">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-center mb-8 text-blue-400">Welcome to LinkVault</h1>
          <Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/view/:id" element={<ViewPage />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}
export default App;