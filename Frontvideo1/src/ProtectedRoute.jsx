import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return <div>กำลังโหลด...</div>; // รอเช็ก login
  console.log(user+" userja");
  if (!user) return <Navigate to="/login" replace />; // ยังไม่ล็อกอิน → ไปหน้า login

  return children;
};
