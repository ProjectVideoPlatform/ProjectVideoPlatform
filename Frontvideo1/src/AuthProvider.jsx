// AuthContext.jsx
import { createContext, useContext, useState, useEffect } from "react";
import videoTracker from "./components/VideoTracker"; // ตรวจสอบ path ให้ถูกต้องนะครับ

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    
    // ถ้าไม่มี token อาจจะข้ามการ fetch ไปเลยเพื่อประหยัด resource
    if (!token) {
      setLoading(false);
      return;
    }

    fetch("http://localhost:3000/api/auth/verify", {
      credentials: "include",
      headers: {
        'Authorization': `Bearer ${token}` 
      }
    })
      .then(res => {
        if (res.status === 401) throw new Error("Not logged in");
        return res.json();
      })
      .then(data => {
        setUser(data.user);
        
        // ✅ [สำคัญ] อัปเดต userId ให้กับ tracker ทันทีที่ยืนยันตัวตนสำเร็จ
        // สมมติว่าใน data.user ของคุณมีฟิลด์ id หรือ userId
        if (videoTracker.updateUserId) {
            videoTracker.updateUserId(data.user.id || data.user.userId);
        }
      })
      .catch(() => {
        setUser(null);
        // กรณี token หมดอายุหรือผิดพลาด อาจจะล้างข้อมูลออก
        // localStorage.removeItem('authToken'); 
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);