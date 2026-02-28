import { useState } from 'react';
import {
    Box, Button, Center, Paper, PasswordInput, Text, TextInput,
    Title, ThemeIcon, Stack, Alert,
} from '@mantine/core';
import { IconLock, IconAlertTriangle, IconHexagon } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(username, password);
        } catch (err) {
            const detail = err.response?.data?.detail;
            setError(
                typeof detail === 'string'
                    ? detail
                    : 'Invalid username or password.'
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box
            style={{
                minHeight: '100vh',
                background: 'var(--bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Paper
                component="form"
                onSubmit={handleSubmit}
                p="xl"
                radius="lg"
                style={{
                    width: 380,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
                }}
            >
                <Stack align="center" mb="xl">
                    <ThemeIcon size={52} radius="xl" color="cyan" variant="light">
                        <IconHexagon size={28} />
                    </ThemeIcon>
                    <Title order={3} c="cyan.4" style={{ letterSpacing: '-0.5px' }}>
                        ⬡ Direttore
                    </Title>
                    <Text size="xs" c="dimmed">Lab Infrastructure Platform</Text>
                </Stack>

                {error && (
                    <Alert
                        color="red"
                        icon={<IconAlertTriangle size={14} />}
                        mb="md"
                        radius="md"
                    >
                        {error}
                    </Alert>
                )}

                <Stack gap="sm">
                    <TextInput
                        id="login-username"
                        label="Username"
                        placeholder="admin"
                        value={username}
                        onChange={e => setUsername(e.currentTarget.value)}
                        autoComplete="username"
                        required
                    />
                    <PasswordInput
                        id="login-password"
                        label="Password"
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.currentTarget.value)}
                        autoComplete="current-password"
                        required
                    />
                    <Button
                        id="login-submit"
                        type="submit"
                        color="cyan"
                        fullWidth
                        mt="xs"
                        loading={loading}
                        leftSection={<IconLock size={14} />}
                    >
                        Sign in
                    </Button>
                </Stack>
            </Paper>
        </Box>
    );
}
