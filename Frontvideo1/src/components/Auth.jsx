import React, { useState, useEffect, memo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthProvider';
import videoTracker from './videoTracker'; // ตรวจสอบ path ให้ถูกต้องนะครับ
const API_BASE_URL = 'http://localhost:3000/api';

const VideoAuthSystem = () => {
    const navigate = useNavigate();
    const { setUser: setAuthUser } = useAuth();
    
    // State management
    const [currentView, setCurrentView] = useState('login');
    const [currentUser, setCurrentUser] = useState(null);
    const [authToken, setAuthToken] = useState(() => {
        // อ่านจาก localStorage เฉพาะตอนเริ่มต้นเท่านั้น
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

    const [currentlyFocusedField, setCurrentlyFocusedField] = useState('email');

    const [loginForm, setLoginForm] = useState({
        email: '',
        password: ''
    });
    const [registerForm, setRegisterForm] = useState({
        email: '',
        password: '',
        role: 'user'
    });

    // --- Utility Handlers (ห่อด้วย useCallback เพื่อความเสถียร) ---

    const showAlert = useCallback((type, message, alertType = 'error') => {
        setAlerts(prev => ({
            ...prev,
            [type]: { message, type: alertType }
        }));
    }, []);

    const clearAlerts = useCallback(() => {
        setAlerts({ login: null, register: null });
    }, []);

    // ฟังก์ชัน API Call ที่ถูกปรับปรุงให้ทนทานต่อ Non-JSON Response
    const apiCall = useCallback(async (endpoint, options = {}) => {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
                ...options.headers
            },
            credentials: 'include',
            ...options
        });

        let data = {};
        try {
            // พยายามอ่าน response เป็น JSON
            data = await response.json();
        } catch (e) {
            // หาก Server ส่ง Non-JSON Response และ Status ไม่ใช่ 2xx ก็ให้โยน Error
            if (!response.ok) {
                throw new Error(`Server error: Status ${response.status}. Failed to parse response.`);
            }
            // ถ้า response.ok แต่ parse ไม่ได้ อาจเป็น response ว่าง (204) หรือผิดปกติ
            return {}; // หรือจัดการตามที่เหมาะสม เช่น return empty object
        }
        
        if (!response.ok) {
            // ใช้ data.message หรือ data.error หรือ status เป็น fallback
            throw new Error(data.message || data.error || `An error occurred with status ${response.status}`);
        }
        
        return data;
    }, [authToken]); // ต้องมี authToken เป็น dependency เพื่อใช้ใน header

    // --- Core Authentication Logic (ห่อด้วย useCallback) ---

    const logout = useCallback(() => {
        setAuthToken(null);
        setCurrentUser(null);
        setAuthUser(null);
        localStorage.removeItem('authToken');
        setCurrentView('login');
        videoTracker.updateUserId(null);
        clearAlerts();
        setCurrentlyFocusedField('email');
    }, [setAuthUser, clearAlerts]); // Dependencies: setAuthUser และ clearAlerts ถูกห่อด้วย useCallback แล้ว

    const getCurrentUser = useCallback(async () => {
        try {
            const response = await apiCall('/auth/verify');
            setCurrentUser(response.user);
            setAuthUser(response.user);
            setCurrentView('profile');
        } catch (error) {
            console.error('Failed to get current user:', error);
            // ถ้าดึงข้อมูลผู้ใช้ไม่สำเร็จ อาจเป็นเพราะ Token หมดอายุ
            logout();
        }
    }, [apiCall, setAuthUser, logout]); // Dependencies: apiCall และ logout ถูกห่อด้วย useCallback แล้ว

    // useEffect เพื่อเช็คสถานะการเข้าสู่ระบบเมื่อ Component Mount
    useEffect(() => {
        if (authToken) {
            getCurrentUser();
        }
    }, [authToken, getCurrentUser]); // เพิ่ม getCurrentUser ใน dependency array

    const handleLogin = useCallback(async () => {
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
            setAuthUser(response.user);
            
            showAlert('login', 'Login successful!', 'success');
            setTimeout(() => setCurrentView('profile'), 1000);
            
        } catch (error) {
            showAlert('login', error.message);
        } finally {
            setLoading(prev => ({ ...prev, login: false }));
        }
    }, [loginForm, apiCall, clearAlerts, setAuthUser, showAlert]); // Dependencies: loginForm, apiCall, setAuthUser, showAlert

    const handleRegister = useCallback(async () => {
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
            setAuthUser(response.user);
            
            showAlert('register', 'Registration successful!', 'success');
            setTimeout(() => setCurrentView('profile'), 1000);
            
        } catch (error) {
            showAlert('register', error.message);
        } finally {
            setLoading(prev => ({ ...prev, register: false }));
        }
    }, [registerForm, apiCall, clearAlerts, setAuthUser, showAlert]); // Dependencies: registerForm, apiCall, setAuthUser, showAlert

    const refreshToken = useCallback(async () => {
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
    }, [apiCall, logout]);

    const redirectToVideos = useCallback(() => {
        if (currentUser) {
            navigate('/');
        }
    }, [currentUser, navigate]);

    const redirectToAdmin = useCallback(() => {
        if (currentUser && currentUser.role === 'admin') {
            navigate('/admin');
        } else {
            alert('Admin access required');
        }
    }, [currentUser, navigate]);

    // --- Presentation Components ---

    const LoadingSpinner = () => (
        <div className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
    );

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

    const LoginForm = memo(() => {
        const emailRef = useRef(null);
        const passwordRef = useRef(null);

       const hasFocusedRef = useRef(false);

useEffect(() => {
    if (hasFocusedRef.current) return;

    const focusElement = (ref) => {
        if (ref.current) {
            const el = ref.current;
            el.focus();
            const length = el.value.length;
            el.setSelectionRange(length, length);
        }
    };

    if (currentlyFocusedField === 'email') {
        focusElement(emailRef);
    } else if (currentlyFocusedField === 'password') {
        focusElement(passwordRef);
    }

    hasFocusedRef.current = true;
}, [currentlyFocusedField]);

        const handleEmailChange = useCallback((e) => {
            setLoginForm(prev => ({ ...prev, email: e.target.value }));
        }, []);

        const handlePasswordChange = useCallback((e) => {
            setLoginForm(prev => ({ ...prev, password: e.target.value }));
        }, []);

        const handleKeyDown = useCallback((e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (currentlyFocusedField === 'email') {
                    setCurrentlyFocusedField('password');
                } else if (currentlyFocusedField === 'password') {
                    handleLogin();
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (currentlyFocusedField === 'email') {
                    setCurrentlyFocusedField('password');
                } else if (currentlyFocusedField === 'password') {
                    setCurrentlyFocusedField('email');
                }
            }
        }, [currentlyFocusedField, handleLogin]);

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

    const RegisterForm = memo(() => {
        const emailRef = useRef(null);
        const passwordRef = useRef(null);
        const roleRef = useRef(null);

        useEffect(() => {
            const focusElement = (ref) => {
                if (ref.current) {
                    const el = ref.current;
                    el.focus();
                    const length = el.value.length;
                    el.setSelectionRange(length, length);
                }
            };

            if (currentlyFocusedField === 'email') {
                focusElement(emailRef);
            } else if (currentlyFocusedField === 'password') {
                focusElement(passwordRef);
            } else if (currentlyFocusedField === 'role') {
                roleRef.current?.focus();
            }
        }, [currentlyFocusedField]);
        
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
                } else if (currentlyFocusedField === 'role') {
                    setCurrentlyFocusedField('email');
                }
            }
        }, [currentlyFocusedField, handleRegister]);

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
                                // onFocus={() => setCurrentlyFocusedField('email')}
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
                                // onFocus={() => setCurrentlyFocusedField('password')}
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