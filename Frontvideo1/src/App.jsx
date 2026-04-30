// App.jsx
import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/errorBoundary';
import { Toaster } from 'react-hot-toast';
import './App.css';
import ProductHomeSection from './components/Video.jsx';
import Admin from './components/admin.jsx';
import Auth from './components/Auth.jsx';
import VideoDetails from './components/VideoDetails.jsx';
import { AuthProvider } from './AuthContext';        // ✅ เปลี่ยนจาก AuthProvider → AuthContext
import { ProtectedRoute } from './ProtectedRoute';
import ForYouPage from './components/ForYou';
import UserProfile from './components/UserProfile.jsx';
import { NotifProvider } from './NotifContext';
import GlobalNotification from './components/GlobalNotification';

const Fallback = () => <div>กำลังโหลด...</div>;

const wrap = (Component) => (
  <ErrorBoundary>
    <Suspense fallback={<Fallback />}>
      <Component />
    </Suspense>
  </ErrorBoundary>
);

function App() {
  return (
    <Router>                {/* ✅ Router ต้องอยู่นอกสุด */}
      <AuthProvider>        {/* ✅ AuthProvider อยู่ใน Router เพื่อให้ useNavigate ทำงานได้ */}
        <NotifProvider>
          <Toaster position="top-center" />
          <GlobalNotification />
          <Routes>          {/* ✅ Routes อันเดียว */}
            <Route path="/login"       element={wrap(Auth)} />
            <Route path="/"            element={<ProtectedRoute>{wrap(ProductHomeSection)}</ProtectedRoute>} />
            <Route path="/admin"       element={<ProtectedRoute>{wrap(Admin)}</ProtectedRoute>} />
            <Route path="/UserProfile" element={<ProtectedRoute>{wrap(UserProfile)}</ProtectedRoute>} />
            <Route path="/foryou"      element={<ProtectedRoute>{wrap(ForYouPage)}</ProtectedRoute>} />
            <Route path="/videoDetails/:id" element={<ProtectedRoute>{wrap(VideoDetails)}</ProtectedRoute>} />
          </Routes>
        </NotifProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;