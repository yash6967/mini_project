import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if user is already logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const response = await authAPI.getMe();
          setUser(response.data);
        } catch (err) {
          console.error('Failed to get user data:', err);
          localStorage.removeItem('token');
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (credentials) => {
    try {
      setError(null);
      console.log('Attempting login...');
      const response = await authAPI.login(credentials);
      const { token, user: userData } = response.data;

      // Store token and user data
      localStorage.setItem('token', token);
      setUser(userData);

      console.log('Login successful');
      return { success: true };
    } catch (err) {
      console.error('Login failed:', err);
      setError(err.response?.data?.message || 'Failed to login');
      return { 
        success: false, 
        error: err.response?.data?.message || 'Invalid credentials'
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const register = async ({ username, email, password }) => {
    try {
      setError(null);
      const response = await authAPI.register({ username, email, password });
      
      if (response.data.success) {
        const { token, user: userData } = response.data;
        if (token && userData) {
          localStorage.setItem('token', token);
          setUser(userData);
          return { success: true };
        }
      }
      
      return { 
        success: false, 
        error: response.data.message || 'Registration failed. Please try again.' 
      };
    } catch (err) {
      console.error('Registration error:', err);
      const errorMessage = err.response?.data?.message || 'Registration failed. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    login,
    logout,
    register
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
