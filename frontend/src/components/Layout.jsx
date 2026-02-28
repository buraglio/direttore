import { NavLink, useLocation } from 'react-router-dom';
import { Box, Text, Stack, ThemeIcon, rem, Tooltip, Badge, Button, Avatar } from '@mantine/core';
import {
    IconLayoutDashboard,
    IconServer,
    IconRocket,
    IconCalendar,
    IconLogout,
} from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';

const ROLE_COLOR = { admin: 'cyan', operator: 'teal', viewer: 'gray' };

const NAV = [
    { to: '/dashboard', label: 'Dashboard', icon: IconLayoutDashboard, permission: null },
    { to: '/resources', label: 'Resources', icon: IconServer, permission: null },
    { to: '/provision', label: 'Provision', icon: IconRocket, permission: 'write:provision' },
    { to: '/reservations', label: 'Reservations', icon: IconCalendar, permission: 'write:reservations' },
];

export default function Layout({ children }) {
    const location = useLocation();
    const { user, logout } = useAuth();

    // Only show nav items the current user has permission for
    const visibleNav = NAV.filter(({ permission }) =>
        !permission || user?.permissions?.includes(permission)
    );

    return (
        <Box style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
            {/* Sidebar */}
            <Box
                style={{
                    width: 220,
                    background: 'var(--surface)',
                    borderRight: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '1.25rem 0',
                    flexShrink: 0,
                }}
            >
                {/* Logo */}
                <Box px="lg" pb="xl">
                    <Text fw={700} size="lg" c="cyan.4" style={{ letterSpacing: '-0.5px' }}>
                        ⬡ Direttore
                    </Text>
                    <Text size="xs" c="dimmed">Lab Infrastructure</Text>
                </Box>

                {/* Nav items */}
                <Stack gap={4} px="sm">
                    {visibleNav.map(({ to, label, icon: Icon }) => {
                        const active = location.pathname.startsWith(to);
                        return (
                            <NavLink
                                key={to}
                                to={to}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: rem(10),
                                    padding: '0.6rem 0.85rem',
                                    borderRadius: 8,
                                    textDecoration: 'none',
                                    color: active ? '#fff' : 'var(--muted)',
                                    background: active ? 'rgba(0,188,212,0.12)' : 'transparent',
                                    fontWeight: active ? 600 : 400,
                                    fontSize: '0.875rem',
                                    transition: 'all 0.15s',
                                    border: active ? '1px solid rgba(0,188,212,0.25)' : '1px solid transparent',
                                }}
                            >
                                <ThemeIcon
                                    size="sm"
                                    variant="transparent"
                                    color={active ? 'cyan' : 'gray'}
                                >
                                    <Icon size={16} />
                                </ThemeIcon>
                                {label}
                            </NavLink>
                        );
                    })}
                </Stack>

                {/* Footer: user info + logout */}
                <Box mt="auto" px="sm" pt="lg" style={{ borderTop: '1px solid var(--border)' }}>
                    {user && (
                        <Box mb="sm" px="xs">
                            <Text size="xs" fw={600} c="white" truncate>
                                {user.username}
                            </Text>
                            <Badge
                                size="xs"
                                color={ROLE_COLOR[user.role] || 'gray'}
                                variant="light"
                                mt={2}
                            >
                                {user.role}
                            </Badge>
                        </Box>
                    )}
                    <Tooltip label="Sign out" position="right">
                        <Button
                            id="sidebar-logout"
                            variant="subtle"
                            color="red"
                            size="xs"
                            fullWidth
                            justify="start"
                            leftSection={<IconLogout size={14} />}
                            onClick={logout}
                        >
                            Sign out
                        </Button>
                    </Tooltip>
                </Box>
            </Box>

            {/* Main content */}
            <Box style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
                {children}
            </Box>
        </Box>
    );
}

