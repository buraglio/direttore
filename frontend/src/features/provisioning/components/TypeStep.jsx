import { Stack, Select, Text, Group, Paper } from '@mantine/core';
import { IconServer, IconBox } from '@tabler/icons-react';

export function TypeStep({ nodeOptions, node, onNodeChange, type, onTypeChange }) {
    const types = [
        { key: 'vm', Icon: IconServer, label: 'Virtual Machine', sub: 'QEMU/KVM full virtualization' },
        { key: 'lxc', Icon: IconBox, label: 'LXC Container', sub: 'Lightweight OS container' },
    ];

    return (
        <Stack gap="md">
            <Select
                label="Proxmox node"
                data={nodeOptions}
                value={node}
                onChange={onNodeChange}
            />
            <Text size="sm" fw={500} mt="xs">Resource type</Text>
            <Group grow>
                {types.map(({ key, Icon, label, sub }) => (
                    <Paper
                        key={key}
                        p="md"
                        radius="md"
                        withBorder
                        onClick={() => onTypeChange(key)}
                        style={{
                            cursor: 'pointer',
                            border: `2px solid ${type === key ? 'var(--cyan)' : 'var(--border)'}`,
                            background: type === key ? 'rgba(0,188,212,0.07)' : 'var(--surface2)',
                            transition: 'all 0.15s',
                        }}
                    >
                        <Group gap="xs" justify="center">
                            <Icon size={24} color={type === key ? 'var(--cyan)' : 'var(--muted)'} />
                            <Stack gap={0}>
                                <Text size="sm" fw={600}>{label}</Text>
                                <Text size="xs" c="dimmed">{sub}</Text>
                            </Stack>
                        </Group>
                    </Paper>
                ))}
            </Group>
        </Stack>
    );
}
