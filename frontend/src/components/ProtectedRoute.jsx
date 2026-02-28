import { Navigate } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import { useAuth } from '../context/AuthContext';

/**
 * ProtectedRoute
 *
 * Wraps any route that requires authentication.
 * Optionally accepts `requiredPermission` — redirects with a 403-like notice
 * if the user lacks that permission string (e.g. "write:provision").
 */
export default function ProtectedRoute({ children, requiredPermission }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <Center style={{ minHeight: '100vh', background: 'var(--bg)' }}>
                <Loader color="cyan" size="lg" />
            </Center>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (requiredPermission && !user.permissions.includes(requiredPermission)) {
        return <Navigate to="/unauthorized" replace />;
    }

    return children;
}
