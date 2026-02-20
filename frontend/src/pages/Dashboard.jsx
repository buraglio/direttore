import { useQuery } from '@tanstack/react-query';
import { Box, Grid, Paper, Text, Progress, Group, Badge, Skeleton, Title, SimpleGrid, RingProgress, Stack } from '@mantine/core';
import { IconServer, IconCpu, IconDeviceFloppy, IconWifi } from '@tabler/icons-react';
import { getNodes, getVMs, getContainers } from '../api/proxmox';

function toGB(bytes) {
    return (bytes / 1073741824).toFixed(1);
}

function NodeCard({ node }) {
    const vmsQ = useQuery({ queryKey: ['vms', node.node], queryFn: () => getVMs(node.node) });
    const lxcQ = useQuery({ queryKey: ['lxc', node.node], queryFn: () => getContainers(node.node) });

    const cpuPct = Math.round(node.cpu * 100);
    const memPct = Math.round((node.mem / node.maxmem) * 100);
    const diskPct = Math.round((node.disk / node.maxdisk) * 100);

    const vms = vmsQ.data || [];
    const lxc = lxcQ.data || [];
    const running = [...vms, ...lxc].filter(x => x.status === 'running').length;
    const total = vms.length + lxc.length;

    const statusColor = node.status === 'online' ? 'green' : 'red';

    return (
        <Paper
            p="lg"
            radius="md"
            style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                transition: 'border-color 0.2s',
            }}
        >
            <Group justify="space-between" mb="md">
                <Group gap="xs">
                    <IconServer size={18} color="var(--cyan)" />
                    <Text fw={600} size="sm">{node.node}</Text>
                </Group>
                <Badge color={statusColor} variant="dot" size="sm">{node.status}</Badge>
            </Group>

            {/* CPU */}
            <Stack gap={4} mb="sm">
                <Group justify="space-between">
                    <Text size="xs" c="dimmed">CPU ({node.maxcpu} vCPU)</Text>
                    <Text size="xs" fw={500}>{cpuPct}%</Text>
                </Group>
                <Progress value={cpuPct} color={cpuPct > 80 ? 'red' : cpuPct > 60 ? 'yellow' : 'cyan'} size="xs" />
            </Stack>

            {/* RAM */}
            <Stack gap={4} mb="sm">
                <Group justify="space-between">
                    <Text size="xs" c="dimmed">RAM ({toGB(node.maxmem)} GB)</Text>
                    <Text size="xs" fw={500}>{toGB(node.mem)} GB / {memPct}%</Text>
                </Group>
                <Progress value={memPct} color={memPct > 85 ? 'red' : memPct > 70 ? 'yellow' : 'cyan'} size="xs" />
            </Stack>

            {/* Disk */}
            <Stack gap={4} mb="md">
                <Group justify="space-between">
                    <Text size="xs" c="dimmed">Disk ({toGB(node.maxdisk)} GB)</Text>
                    <Text size="xs" fw={500}>{toGB(node.disk)} GB / {diskPct}%</Text>
                </Group>
                <Progress value={diskPct} color={diskPct > 90 ? 'red' : 'teal'} size="xs" />
            </Stack>

            <Group gap="xs">
                <Badge variant="light" color="green" size="sm">{running} running</Badge>
                <Badge variant="light" color="gray" size="sm">{total} total</Badge>
                <Badge variant="light" color="blue" size="sm">{vms.length} VMs / {lxc.length} CTs</Badge>
            </Group>
        </Paper>
    );
}

export default function Dashboard() {
    const { data: nodes, isLoading, isError } = useQuery({
        queryKey: ['nodes'],
        queryFn: getNodes,
        refetchInterval: 30000,
    });

    return (
        <Box>
            <Title order={2} mb={4} style={{ color: 'var(--text)' }}>Dashboard</Title>
            <Text c="dimmed" size="sm" mb="xl">Proxmox cluster overview — refreshes every 30s</Text>

            {isError && (
                <Paper p="md" mb="lg" style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid var(--red)' }}>
                    <Text size="sm" c="red">Could not reach API. Make sure the backend is running.</Text>
                </Paper>
            )}

            {isLoading ? (
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
                    {[1, 2].map(i => <Skeleton key={i} height={240} radius="md" />)}
                </SimpleGrid>
            ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
                    {(nodes || []).map(node => <NodeCard key={node.node} node={node} />)}
                </SimpleGrid>
            )}
        </Box>
    );
}
