'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in from localStorage
    const userData = localStorage.getItem('user');
    const tokenData = localStorage.getItem('token');
    if (userData) {
      try {
        setUser(JSON.parse(userData));
        if (tokenData) {
          setToken(tokenData);
          // Set token in cookie for HTTP requests
          document.cookie = `token=${tokenData}; path=/`;
        }
      } catch (error) {
        console.error('Failed to parse user data:', error);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }
    setLoading(false);
  }, []);

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    // Clear token cookie
    document.cookie = 'token=; path=/; max-age=0';
  };

  const login = (userData, tokenData) => {
    setUser(userData);
    setToken(tokenData);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', tokenData);
    // Store only token in cookie for HTTP requests
    document.cookie = `token=${tokenData}; path=/`;
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, login, token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
