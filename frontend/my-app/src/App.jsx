
import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/errorBoundary';
import { Toaster } from 'react-hot-toast';
import './App.css'
import ProductHomeSection from './components/Video.jsx';
import Admin from './components/admin.jsx';
import Auth from './components/Auth.jsx';
import VideoDetails from './components/VideoDetails.jsx';
function App() {
  return (
      <Router>
      <Toaster position="top-center" />
      <Routes>
        <Route path="/" element={<ProductHomeSection />} />

        <Route
          path="/admin"
          element={
            <ErrorBoundary>
              <Suspense fallback={<div>กำลังโหลด...</div>}>
                <Admin />
              </Suspense>
            </ErrorBoundary>
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
          path="/videoDetails/:id"
          element={
            <ErrorBoundary>
              <Suspense fallback={<div>กำลังโหลด...</div>}>
                <VideoDetails />
              </Suspense>
            </ErrorBoundary>
          }
        />
      </Routes>
    </Router>
  )
}

export default App
