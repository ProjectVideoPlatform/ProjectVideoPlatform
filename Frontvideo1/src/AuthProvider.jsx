import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // เรียก backend เพื่อตรวจ token / cookie
    fetch("http://localhost:3000/api/auth/verify", {
      credentials: "include",
        headers: {
           'Authorization': `Bearer ${localStorage.getItem('authToken')}` 
        }
    })
      .then(res => {
        if (res.status === 401) throw new Error("Not logged in");
        return res.json();
      })
      .then(data => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    
    <AuthContext.Provider value={{ user, setUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};


export const useAuth = () => useContext(AuthContext);
