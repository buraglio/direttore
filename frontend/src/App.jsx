import { MantineProvider, createTheme, Box, Text, Button, Center } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Resources from './pages/Resources';
import Provision from './pages/Provision';
import Reservations from './pages/Reservations';

import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

const theme = createTheme({
  primaryColor: 'cyan',
  defaultRadius: 'md',
  fontFamily: 'Inter, sans-serif',
});

function Unauthorized() {
  return (
    <Center style={{ minHeight: '100vh', background: 'var(--bg)', flexDirection: 'column', gap: 16 }}>
      <Text size="xl" fw={700} c="red">403 — Insufficient permissions</Text>
      <Text c="dimmed" size="sm">Your account does not have access to this page.</Text>
      <Button variant="subtle" color="cyan" onClick={() => history.back()}>Go back</Button>
    </Center>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <Notifications position="top-right" />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* Protected routes — all wrapped in Layout */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <Layout><Dashboard /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/resources" element={
                <ProtectedRoute>
                  <Layout><Resources /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/provision" element={
                <ProtectedRoute requiredPermission="write:provision">
                  <Layout><Provision /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/reservations" element={
                <ProtectedRoute requiredPermission="write:reservations">
                  <Layout><Reservations /></Layout>
                </ProtectedRoute>
              } />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}

