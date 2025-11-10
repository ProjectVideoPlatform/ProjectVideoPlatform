  import React, { useState, useEffect, memo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
  const VideoAuthSystem = () => {
    const navigate = useNavigate();
    // State management
    const [currentView, setCurrentView] = useState('login'); // 'login', 'register', 'profile'
    const [currentUser, setCurrentUser] = useState(null);
    const [authToken, setAuthToken] = useState(() => {
      return typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
    });
    const [loading, setLoading] = useState({
      login: false,
      register: false
    });
    const [alerts, setAlerts] = useState({
      login: null,
      register: null
    });

    // Focus tracking states (similar to admin dashboard)
    const [currentlyFocusedField, setCurrentlyFocusedField] = useState('email');

    // Form data
    const [loginForm, setLoginForm] = useState({
      email: '',
      password: ''
    });
    const [registerForm, setRegisterForm] = useState({
      email: '',
      password: '',
      role: 'user'
    });

    // Configuration
    const API_BASE_URL = 'http://localhost:3000/api';

    // Initialize component
    useEffect(() => {
      if (authToken) {
        getCurrentUser();
      }
    }, []);

    // Alert management
    const showAlert = useCallback((type, message, alertType = 'error') => {
      setAlerts(prev => ({
        ...prev,
        [type]: { message, type: alertType }
      }));
    }, []);

    const clearAlerts = useCallback(() => {
      setAlerts({ login: null, register: null });
    }, []);

    // API call helper
    const apiCall = async (endpoint, options = {}) => {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
          ...options.headers
        },
        ...options
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'An error occurred');
      }
      
      return data;
    };

    // Authentication functions
    const handleLogin = async () => {
      setLoading(prev => ({ ...prev, login: true }));
      clearAlerts();
      
      try {
        const response = await apiCall('/auth/login', {
          method: 'POST',
          body: JSON.stringify(loginForm)
        });
        
        const token = response.token;
        setAuthToken(token);
        localStorage.setItem('authToken', token);
        setCurrentUser(response.user);
        
        showAlert('login', 'Login successful!', 'success');
        setTimeout(() => setCurrentView('profile'), 1000);
        
      } catch (error) {
        showAlert('login', error.message);
      } finally {
        setLoading(prev => ({ ...prev, login: false }));
      }
    };

    const handleRegister = async () => {
      setLoading(prev => ({ ...prev, register: true }));
      clearAlerts();
      
      try {
        const response = await apiCall('/auth/register', {
          method: 'POST',
          body: JSON.stringify(registerForm)
        });
        
        const token = response.token;
        setAuthToken(token);
        localStorage.setItem('authToken', token);
        setCurrentUser(response.user);
        
        showAlert('register', 'Registration successful!', 'success');
        setTimeout(() => setCurrentView('profile'), 1000);
        
      } catch (error) {
        showAlert('register', error.message);
      } finally {
        setLoading(prev => ({ ...prev, register: false }));
      }
    };

    const getCurrentUser = async () => {
      try {
        const response = await apiCall('/auth/me');
        setCurrentUser(response.user);
        setCurrentView('profile');
      } catch (error) {
        console.error('Failed to get current user:', error);
        logout();
      }
    };

    const refreshToken = async () => {
      try {
        const response = await apiCall('/auth/refresh', {
          method: 'POST'
        });
        
        const token = response.token;
        setAuthToken(token);
        localStorage.setItem('authToken', token);
        
        alert('Token refreshed successfully!');
      } catch (error) {
        alert('Failed to refresh token: ' + error.message);
        logout();
      }
    };

    const logout = () => {
      setAuthToken(null);
      setCurrentUser(null);
      localStorage.removeItem('authToken');
      setCurrentView('login');
      clearAlerts();
      setCurrentlyFocusedField('email'); // Reset focus
    };

    // Navigation functions
    const redirectToVideos = () => {
      if (currentUser) {
        navigate('/');
      }
    };

    const redirectToAdmin = () => {
      if (currentUser && currentUser.role === 'admin') {
        navigate('/admin');
      } else {
        alert('Admin access required');
      }
    };

    // Loading spinner component
    const LoadingSpinner = () => (
      <div className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
    );

    // Alert component
    const Alert = memo(({ alert }) => {
      if (!alert) return null;
      
      const bgColor = alert.type === 'success' 
        ? 'bg-green-50 border-green-200 text-green-800' 
        : 'bg-red-50 border-red-200 text-red-800';
      
      return (
        <div className={`p-3 rounded-lg border text-sm mb-5 ${bgColor}`}>
          {alert.message}
        </div>
      );
    });
    Alert.displayName = 'Alert';

    // Login Form Component with enhanced focus system
    const LoginForm = memo(() => {
      const emailRef = useRef(null);
      const passwordRef = useRef(null);

      // Enhanced focus effect similar to admin dashboard
      useEffect(() => {
        if (currentlyFocusedField === 'email' && emailRef.current) {
          const el = emailRef.current;
          el.focus();
          const length = el.value.length;
          el.setSelectionRange(length, length);
        } else if (currentlyFocusedField === 'password' && passwordRef.current) {
          const el = passwordRef.current;
          el.focus();
          const length = el.value.length;
          el.setSelectionRange(length, length);
        }
      }, [loginForm, currentlyFocusedField]);

      const handleEmailChange = useCallback((e) => {
        setLoginForm(prev => ({ ...prev, email: e.target.value }));
      }, []);

      const handlePasswordChange = useCallback((e) => {
        setLoginForm(prev => ({ ...prev, password: e.target.value }));
      }, []);
const handleKeyDown = useCallback((e) => {
      if (e.key === 'Enter') {
        console.log(  'Enter pressed');
        e.preventDefault();
        if (currentlyFocusedField === 'email') {
          setCurrentlyFocusedField('password');
        } else if (currentlyFocusedField === 'password') {
          handleLogin();
        }
      } else if (e.key === 'Tab') {
        console.log('Tab pressed');
        e.preventDefault();
        if (currentlyFocusedField === 'email') {
          setCurrentlyFocusedField('password');
        } else {
          setCurrentlyFocusedField('email');
        }
      }
    }, [currentlyFocusedField]);


      return (
        <div>
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-8 text-center">
            <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
            <p className="opacity-90 text-sm">Sign in to your account</p>
          </div>
          <div className="p-8">
            <Alert alert={alerts.login} />
            <form onSubmit={(e) => e.preventDefault()}>
              <div className="mb-5">
                <label className="block mb-2 font-semibold text-gray-700">Email</label>
                <input
                  ref={emailRef}
                  type="text"
                  value={loginForm.email}
                  onChange={handleEmailChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setCurrentlyFocusedField('email')}
                  className={`w-full p-3 border-2 rounded-xl text-base focus:outline-none transition-all duration-200 ${
                    currentlyFocusedField === 'email' 
                      ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-lg' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="mb-5">
                <label className="block mb-2 font-semibold text-gray-700">Password</label>
                <input
                  ref={passwordRef}
                  type="password"
                  value={loginForm.password}
                  onChange={handlePasswordChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setCurrentlyFocusedField('password')}
                  className={`w-full p-3 border-2 rounded-xl text-base focus:outline-none transition-all duration-200 ${
                    currentlyFocusedField === 'password' 
                      ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-lg' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  required
                  autoComplete="current-password"
                />
              </div>
              <button
                type="button"
                onClick={handleLogin}
                disabled={loading.login}
                className="w-full p-4 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl text-base font-semibold cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none focus:outline-none focus:ring-4 focus:ring-indigo-300"
              >
                {loading.login ? <LoadingSpinner /> : 'Sign In'}
              </button>
            </form>
            <div className="text-center mt-5 pt-5 border-t border-gray-200">
              <p>Don't have an account? 
                <button 
                  onClick={() => {
                    setCurrentView('register');
                    setCurrentlyFocusedField('email');
                  }} 
                  className="text-indigo-500 font-semibold hover:underline ml-1 focus:outline-none focus:ring-2 focus:ring-indigo-300 rounded px-1"
                >
                  Sign up
                </button>
              </p>
            </div>
          </div>
        </div>
      );
    });
    LoginForm.displayName = 'LoginForm';

    // Register Form Component with enhanced focus system
    const RegisterForm = memo(() => {
      const emailRef = useRef(null);
      const passwordRef = useRef(null);
      const roleRef = useRef(null);

      // Enhanced focus effect similar to admin dashboard
      useEffect(() => {
        if (currentlyFocusedField === 'email' && emailRef.current) {
          const el = emailRef.current;
          el.focus();
          const length = el.value.length;
          el.setSelectionRange(length, length);
        } else if (currentlyFocusedField === 'password' && passwordRef.current) {
          const el = passwordRef.current;
          el.focus();
          const length = el.value.length;
          el.setSelectionRange(length, length);
        } else if (currentlyFocusedField === 'role' && roleRef.current) {
          roleRef.current.focus();
        }
      }, [registerForm, currentlyFocusedField]);

      const handleEmailChange = useCallback((e) => {
        setRegisterForm(prev => ({ ...prev, email: e.target.value }));
      }, []);

      const handlePasswordChange = useCallback((e) => {
        setRegisterForm(prev => ({ ...prev, password: e.target.value }));
      }, []);

      const handleRoleChange = useCallback((e) => {
        setRegisterForm(prev => ({ ...prev, role: e.target.value }));
      }, []);

      const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (currentlyFocusedField === 'email') {
            setCurrentlyFocusedField('password');
          } else if (currentlyFocusedField === 'password') {
            setCurrentlyFocusedField('role');
          } else if (currentlyFocusedField === 'role') {
            handleRegister();
          }
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (currentlyFocusedField === 'email') {
            setCurrentlyFocusedField('password');
          } else if (currentlyFocusedField === 'password') {
            setCurrentlyFocusedField('role');
          } else {
            setCurrentlyFocusedField('email');
          }
        }
      }, [currentlyFocusedField]);


      return (
        <div>
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-8 text-center">
            <h1 className="text-3xl font-bold mb-2">Join Us</h1>
            <p className="opacity-90 text-sm">Create your account</p>
          </div>
          <div className="p-8">
            <Alert alert={alerts.register} />
            <form onSubmit={(e) => e.preventDefault()}>
              <div className="mb-5">
                <label className="block mb-2 font-semibold text-gray-700">Email</label>
                <input
                  ref={emailRef}
                  type="text"
                  value={registerForm.email}
                  onChange={handleEmailChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setCurrentlyFocusedField('email')}
                  className={`w-full p-3 border-2 rounded-xl text-base focus:outline-none transition-all duration-200 ${
                    currentlyFocusedField === 'email' 
                      ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-lg' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="mb-5">
                <label className="block mb-2 font-semibold text-gray-700">Password</label>
                <input
                  ref={passwordRef}
                  type="password"
                  value={registerForm.password}
                  onKeyDown={handleKeyDown}
                  onChange={handlePasswordChange}
                  onFocus={() => setCurrentlyFocusedField('password')}
                  className={`w-full p-3 border-2 rounded-xl text-base focus:outline-none transition-all duration-200 ${
                    currentlyFocusedField === 'password' 
                      ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-lg' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="mb-5">
                <label className="block mb-2 font-semibold text-gray-700">Role</label>
                <select
                  ref={roleRef}
                  value={registerForm.role}
                  onChange={handleRoleChange}
                  onFocus={() => setCurrentlyFocusedField('role')}
                  onKeyDown={handleKeyDown}
                  className={`w-full p-3 border-2 rounded-xl text-base bg-white focus:outline-none transition-all duration-200 ${
                    currentlyFocusedField === 'role' 
                      ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-lg' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleRegister}
                disabled={loading.register}
                className="w-full p-4 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl text-base font-semibold cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none focus:outline-none focus:ring-4 focus:ring-indigo-300"
              >
                {loading.register ? <LoadingSpinner /> : 'Sign Up'}
              </button>
            </form>
            <div className="text-center mt-5 pt-5 border-t border-gray-200">
              <p>Already have an account? 
                <button 
                  onClick={() => {
                    setCurrentView('login');
                    setCurrentlyFocusedField('email');
                  }} 
                  className="text-indigo-500 font-semibold hover:underline ml-1 focus:outline-none focus:ring-2 focus:ring-indigo-300 rounded px-1"
                >
                  Sign in
                </button>
              </p>
            </div>
          </div>
        </div>
      );
    });
    RegisterForm.displayName = 'RegisterForm';

    // User Profile Component
    const UserProfile = memo(() => (
      <div>
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-8 text-center">
          <h1 className="text-3xl font-bold mb-2">Welcome!</h1>
          <p className="opacity-90 text-sm">You are successfully logged in</p>
        </div>
        <div className="p-8 text-center">
          <div className="bg-gray-50 p-5 rounded-xl mb-5">
            <h3 className="text-gray-800 mb-2 text-xl font-semibold">{currentUser?.email}</h3>
            <p className="text-gray-600 mb-1">
              Role: <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase ${
                currentUser?.role === 'admin' ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800'
              }`}>{currentUser?.role}</span>
            </p>
            <p className="text-gray-600">User ID: <span>{currentUser?.id}</span></p>
          </div>
          
          <button
            onClick={refreshToken}
            className="w-full p-4 bg-gray-200 text-gray-700 rounded-xl text-base font-semibold mb-3 transition-all duration-200 hover:bg-gray-300 focus:outline-none focus:ring-4 focus:ring-gray-300"
          >
            Refresh Token
          </button>
          
          <button
            onClick={logout}
            className="w-full p-4 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl text-base font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/30 focus:outline-none focus:ring-4 focus:ring-indigo-300"
          >
            Logout
          </button>
          
          <div className="text-center mt-5 pt-5 border-t border-gray-200">
            <p>
              <button 
                onClick={redirectToVideos} 
                className="text-indigo-500 font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-300 rounded px-1"
              >
                Go to Videos →
              </button>
            </p>
            <p>
              <button 
                onClick={redirectToAdmin} 
                className="text-indigo-500 font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-300 rounded px-1"
              >
                Admin Panel →
              </button>
            </p>
          </div>
        </div>
      </div>
    ));
    UserProfile.displayName = 'UserProfile';

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-sans">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden w-full max-w-md min-h-[500px]">
          {currentView === 'login' && <LoginForm />}
          {currentView === 'register' && <RegisterForm />}
          {currentView === 'profile' && <UserProfile />}
        </div>
      </div>
    );
  };

  export default VideoAuthSystem;