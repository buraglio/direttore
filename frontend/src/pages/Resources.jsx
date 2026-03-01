import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Box, Title, Text, Select, Tabs, Table, Badge, Group, ActionIcon,
    Skeleton, Button, Tooltip, Paper, Alert,
} from '@mantine/core';
import {
    IconPlayerPlay, IconPlayerStop, IconTrash, IconRefresh,
} from '@tabler/icons-react';
import { getNodes, getVMs, getContainers, vmAction, containerAction, pollTask } from '../api/proxmox';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';

function toGB(bytes) { return (bytes / 1073741824).toFixed(1); }

function statusColor(status) {
    return { running: 'green', stopped: 'red', paused: 'yellow' }[status] || 'gray';
}

function ResourceTable({ items, type, node, onAction, loadingAction }) {
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
                                        loading={loadingAction?.vmid === item.vmid && loadingAction?.action === 'start'}
                                        disabled={item.status === 'running' || (loadingAction && loadingAction.vmid === item.vmid)}
                                        onClick={() => onAction(item.vmid, 'start', type)}
                                    >
                                        <IconPlayerPlay size={12} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Stop" withArrow>
                                    <ActionIcon
                                        size="sm" variant="light" color="orange"
                                        loading={loadingAction?.vmid === item.vmid && loadingAction?.action === 'stop'}
                                        disabled={item.status !== 'running' || (loadingAction && loadingAction.vmid === item.vmid)}
                                        onClick={() => onAction(item.vmid, 'stop', type)}
                                    >
                                        <IconPlayerStop size={12} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Delete" withArrow>
                                    <ActionIcon
                                        size="sm" variant="light" color="red"
                                        loading={loadingAction?.vmid === item.vmid && loadingAction?.action === 'delete'}
                                        disabled={loadingAction && loadingAction.vmid === item.vmid}
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

    const [loadingAction, setLoadingAction] = useState(null); // { vmid, action }

    const doAction = useMutation({
        mutationFn: async ({ vmid, action, type }) => {
            const res = type === 'vm' ? await vmAction(node, vmid, action) : await containerAction(node, vmid, action);
            if (!res.upid) throw new Error("No task UPID returned.");
            return res.upid;
        },
        onMutate: (vars) => {
            setLoadingAction({ vmid: vars.vmid, action: vars.action });
        },
        onSuccess: async (upid, vars) => {
            notifications.show({
                id: upid,
                color: 'blue', title: 'Task executing...',
                message: `${vars.action} for VMID ${vars.vmid} is in progress.`,
                loading: true,
                autoClose: false,
            });

            // Poll the UPID task endpoint until status stops being 'running'
            while (true) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    const task = await pollTask(node, upid);
                    if (task?.status === 'stopped') {
                        if (task.exitstatus === 'OK') {
                            notifications.update({
                                id: upid,
                                color: 'green', title: 'Task complete',
                                message: `Successfully executed ${vars.action} on VMID ${vars.vmid}.`,
                                loading: false, autoClose: 5000,
                            });
                        } else {
                            notifications.update({
                                id: upid,
                                color: 'red', title: 'Task failed',
                                message: `Proxmox error: ${task.exitstatus}`,
                                loading: false, autoClose: 5000,
                            });
                        }
                        break;
                    }
                } catch (e) {
                    console.error("Polling error", e);
                    break;
                }
            }

            qc.invalidateQueries({ queryKey: ['vms', node] });
            qc.invalidateQueries({ queryKey: ['lxc', node] });
            setLoadingAction(null);
        },
        onError: (err, vars) => {
            notifications.show({
                color: 'red', title: 'Task failed to start',
                message: err.message || `Failed to ${vars.action} VMID ${vars.vmid}`,
            });
            setLoadingAction(null);
        }
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
                    style={{ minWidth: 200 }}
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
                                items={vmsQ.data || []} type="vm" node={node} loadingAction={loadingAction}
                                onAction={(vmid, action, type) => doAction.mutate({ vmid, action, type })}
                            />
                        )}
                    </Tabs.Panel>

                    <Tabs.Panel value="lxc">
                        {lxcQ.isLoading ? <Skeleton height={100} /> : (
                            <ResourceTable
                                items={lxcQ.data || []} type="lxc" node={node} loadingAction={loadingAction}
                                onAction={(vmid, action, type) => doAction.mutate({ vmid, action, type })}
                            />
                        )}
                    </Tabs.Panel>
                </Tabs>
            </Paper>
        </Box>
    );
}
