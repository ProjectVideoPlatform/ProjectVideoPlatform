
import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/errorBoundary';
import { Toaster } from 'react-hot-toast';
import './App.css'
import ProductHomeSection from './components/Video.jsx';
import Admin from './components/admin.jsx';
import Auth from './components/Auth.jsx';
import VideoDetails from './components/VideoDetails.jsx';
import { AuthProvider } from './AuthProvider';
import { ProtectedRoute } from './ProtectedRoute';
import UserProfile from './components/UserProfile.jsx';
function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-center" />
        <Routes>
          <Route path="/"
           element={
            <ProtectedRoute>
                <ErrorBoundary>
                  <Suspense fallback={<div>กำลังโหลด...</div>}>
                     <ProductHomeSection />
                  </Suspense>
                </ErrorBoundary>
              </ProtectedRoute>
        } />
          
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <ErrorBoundary>
                  <Suspense fallback={<div>กำลังโหลด...</div>}>
                    <Admin />
                  </Suspense>
                </ErrorBoundary>
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/login"
            element={
              <ErrorBoundary>
                <Suspense fallback={<div>กำลังโหลด...</div>}>
                  <Auth />
                </Suspense>
              </ErrorBoundary>
            }
          />
 <Route
            path="/UserProfile"
            element={
              <ProtectedRoute>
                <ErrorBoundary>
                  <Suspense fallback={<div>กำลังโหลด...</div>}>
                    <UserProfile />
                  </Suspense>
                </ErrorBoundary>
              </ProtectedRoute>
            }
          />
          <Route
            path="/videoDetails/:id"
            element={
              <ProtectedRoute>
                <ErrorBoundary>
                  <Suspense fallback={<div>กำลังโหลด...</div>}>
                    <VideoDetails />
                  </Suspense>
                </ErrorBoundary>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
export default App
