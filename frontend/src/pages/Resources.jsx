import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Box, Title, Text, Select, Tabs, Table, Badge, Group, ActionIcon,
    Skeleton, Button, Tooltip, Paper, Alert,
} from '@mantine/core';
import {
    IconPlayerPlay, IconPlayerStop, IconTrash, IconRefresh,
} from '@tabler/icons-react';
import { getNodes, getVMs, getContainers, vmAction, containerAction } from '../api/proxmox';
import { useNavigate } from 'react-router-dom';

function toGB(bytes) { return (bytes / 1073741824).toFixed(1); }

function statusColor(status) {
    return { running: 'green', stopped: 'red', paused: 'yellow' }[status] || 'gray';
}

function ResourceTable({ items, type, node, onAction }) {
    if (!items.length) return <Text c="dimmed" size="sm" py="md">No {type}s on this node.</Text>;

    return (
        <Table striped highlightOnHover verticalSpacing="xs" style={{ '--table-striped-color': 'var(--surface2)' }}>
            <Table.Thead>
                <Table.Tr>
                    <Table.Th>VMID</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>CPU</Table.Th>
                    <Table.Th>RAM</Table.Th>
                    <Table.Th>Uptime</Table.Th>
                    <Table.Th>Actions</Table.Th>
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {items.map(item => (
                    <Table.Tr key={item.vmid}>
                        <Table.Td><Text size="sm" c="cyan.4" fw={500}>{item.vmid}</Text></Table.Td>
                        <Table.Td><Text size="sm" fw={500}>{item.name || item.hostname}</Text></Table.Td>
                        <Table.Td>
                            <Badge color={statusColor(item.status)} variant="dot" size="sm">{item.status}</Badge>
                        </Table.Td>
                        <Table.Td><Text size="sm">{item.cpus} vCPU</Text></Table.Td>
                        <Table.Td><Text size="sm">{toGB(item.maxmem)} GB</Text></Table.Td>
                        <Table.Td>
                            <Text size="sm" c="dimmed">
                                {item.uptime ? `${Math.floor(item.uptime / 3600)}h` : '—'}
                            </Text>
                        </Table.Td>
                        <Table.Td>
                            <Group gap={4}>
                                <Tooltip label="Start" withArrow>
                                    <ActionIcon
                                        size="sm" variant="light" color="green"
                                        disabled={item.status === 'running'}
                                        onClick={() => onAction(item.vmid, 'start', type)}
                                    >
                                        <IconPlayerPlay size={12} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Stop" withArrow>
                                    <ActionIcon
                                        size="sm" variant="light" color="orange"
                                        disabled={item.status !== 'running'}
                                        onClick={() => onAction(item.vmid, 'stop', type)}
                                    >
                                        <IconPlayerStop size={12} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Delete" withArrow>
                                    <ActionIcon
                                        size="sm" variant="light" color="red"
                                        onClick={() => onAction(item.vmid, 'delete', type)}
                                    >
                                        <IconTrash size={12} />
                                    </ActionIcon>
                                </Tooltip>
                            </Group>
                        </Table.Td>
                    </Table.Tr>
                ))}
            </Table.Tbody>
        </Table>
    );
}

export default function Resources() {
    const qc = useQueryClient();
    const [activeNode, setActiveNode] = useState(null);
    const navigate = useNavigate();

    const nodesQ = useQuery({ queryKey: ['nodes'], queryFn: getNodes });
    const nodes = nodesQ.data || [];
    const node = activeNode || nodes[0]?.node;

    const vmsQ = useQuery({
        queryKey: ['vms', node], queryFn: () => getVMs(node), enabled: !!node,
    });
    const lxcQ = useQuery({
        queryKey: ['lxc', node], queryFn: () => getContainers(node), enabled: !!node,
    });

    const doAction = useMutation({
        mutationFn: ({ vmid, action, type }) =>
            type === 'vm' ? vmAction(node, vmid, action) : containerAction(node, vmid, action),
        onSuccess: (_, vars) => {
            notifications.show({
                color: 'cyan', title: 'Task submitted',
                message: `${vars.action} for VMID ${vars.vmid}`,
            });
            setTimeout(() => { qc.invalidateQueries(['vms', node]); qc.invalidateQueries(['lxc', node]); }, 1500);
        },
    });

    const nodeOptions = nodes.map(n => ({ value: n.node, label: n.node }));

    return (
        <Box>
            <Group justify="space-between" mb="md">
                <Box>
                    <Title order={2} mb={2} style={{ color: 'var(--text)' }}>Resources</Title>
                    <Text c="dimmed" size="sm">Manage VMs and containers across Proxmox nodes</Text>
                </Box>
                <Group>
                    <Button
                        size="sm" variant="light" color="cyan" leftSection={<IconRefresh size={14} />}
                        onClick={() => { qc.invalidateQueries(['vms', node]); qc.invalidateQueries(['lxc', node]); }}
                    >
                        Refresh
                    </Button>
                    <Button size="sm" color="cyan" onClick={() => navigate('/provision')}>
                        + Provision New
                    </Button>
                </Group>
            </Group>

            <Group mb="lg" align="flex-end">
                <Select
                    label="Node"
                    data={nodeOptions}
                    value={node}
                    onChange={setActiveNode}
                    style={{ width: 200 }}
                />
            </Group>

            <Paper p="md" radius="md" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <Tabs defaultValue="vms" color="cyan">
                    <Tabs.List mb="md">
                        <Tabs.Tab value="vms">
                            Virtual Machines
                            {vmsQ.data && <Badge ml="xs" size="xs" color="gray">{vmsQ.data.length}</Badge>}
                        </Tabs.Tab>
                        <Tabs.Tab value="lxc">
                            Containers (LXC)
                            {lxcQ.data && <Badge ml="xs" size="xs" color="gray">{lxcQ.data.length}</Badge>}
                        </Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="vms">
                        {vmsQ.isLoading ? <Skeleton height={100} /> : (
                            <ResourceTable
                                items={vmsQ.data || []} type="vm" node={node}
                                onAction={(vmid, action, type) => doAction.mutate({ vmid, action, type })}
                            />
                        )}
                    </Tabs.Panel>

                    <Tabs.Panel value="lxc">
                        {lxcQ.isLoading ? <Skeleton height={100} /> : (
                            <ResourceTable
                                items={lxcQ.data || []} type="lxc" node={node}
                                onAction={(vmid, action, type) => doAction.mutate({ vmid, action, type })}
                            />
                        )}
                    </Tabs.Panel>
                </Tabs>
            </Paper>
        </Box>
    );
}
