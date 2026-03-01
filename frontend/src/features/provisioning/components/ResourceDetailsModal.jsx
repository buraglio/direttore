import { Modal, Text, Group, Box, Badge, CopyButton, ActionIcon, Tooltip, Stack, Title, Grid, Skeleton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { getVM, getContainer } from '../../../api/proxmox';
import { IconCopy, IconCheck } from '@tabler/icons-react';

function toMB(bytes) { return bytes ? (bytes / 1048576).toFixed(0) + ' MB' : '—'; }
function toGB(bytes) { return bytes ? (bytes / 1073741824).toFixed(1) + ' GB' : '—'; }
function formatUptime(seconds) {
    if (!seconds) return '—';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
}

function DetailItem({ label, value }) {
    if (value === undefined || value === null || value === '') return null;
    return (
        <Box mb="xs">
            <Text size="sm" c="dimmed" fw={500}>{label}</Text>
            <Group gap="xs">
                <Text size="md" style={{ wordBreak: 'break-all', color: 'var(--text)' }}>{String(value)}</Text>
                {String(value).length > 5 && (
                    <CopyButton value={String(value)} timeout={2000}>
                        {({ copied, copy }) => (
                            <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                                <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy}>
                                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                                </ActionIcon>
                            </Tooltip>
                        )}
                    </CopyButton>
                )}
            </Group>
        </Box>
    );
}

export default function ResourceDetailsModal({ opened, onClose, resource, node }) {
    if (!resource || !node) return null;

    const { vmid, type } = resource;

    const { data: details, isLoading, isError } = useQuery({
        queryKey: ['resourceDetails', node, vmid, type],
        queryFn: () => type === 'vm' ? getVM(node, vmid) : getContainer(node, vmid),
        enabled: opened && !!vmid && !!node,
    });

    const config = details?.config || {};
    const status = details?.status || {};
    const name = config.name || config.hostname || 'Unknown';

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <Group gap="sm">
                    <Title order={3} style={{ color: 'var(--text)' }}>{name}</Title>
                    <Badge color={status.status === 'running' ? 'green' : 'red'}>{status.status}</Badge>
                    <Badge variant="outline" color="cyan">VMID {vmid}</Badge>
                </Group>
            }
            size="lg"
            closeOnClickOutside={false}
            overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
            styles={{
                content: { background: 'var(--surface)', border: '1px solid var(--border)' },
                header: { background: 'var(--surface)' },
            }}
        >
            {isLoading && <Skeleton height={200} />}
            {isError && <Text color="red">Failed to load resource details.</Text>}
            {details && !isLoading && !isError && (
                <Stack>
                    <Box style={{ padding: 'var(--mantine-spacing-md)', background: 'var(--surface2)', borderRadius: 'var(--mantine-radius-md)' }}>
                        <Title order={5} mb="sm" c="cyan.4">Current Status</Title>
                        <Grid>
                            <Grid.Col span={6}>
                                <DetailItem label="CPU Usage" value={status.cpu ? `${(status.cpu * 100).toFixed(1)}%` : '0%'} />
                                <DetailItem label="CPUs" value={status.cpus} />
                                <DetailItem label="Uptime" value={formatUptime(status.uptime)} />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <DetailItem label="Memory Usage" value={`${toMB(status.mem)} / ${toMB(status.maxmem)}`} />
                                <DetailItem label="Disk Usage" value={`${toGB(status.disk)} / ${toGB(status.maxdisk)}`} />
                                <DetailItem label="HA State" value={status.ha?.state} />
                            </Grid.Col>
                        </Grid>
                    </Box>

                    <Box style={{ padding: 'var(--mantine-spacing-md)', background: 'var(--surface2)', borderRadius: 'var(--mantine-radius-md)' }}>
                        <Title order={5} mb="sm" c="cyan.4">Configuration</Title>
                        <Grid>
                            <Grid.Col span={6}>
                                <DetailItem label="Boot" value={config.boot} />
                                <DetailItem label="Protection" value={config.protection ? 'Enabled' : 'Disabled'} />
                                {type === 'lxc' && <DetailItem label="Unprivileged" value={config.unprivileged ? 'Yes' : 'No'} />}
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <DetailItem label="Network (net0)" value={config.net0} />
                                <DetailItem label="Network (net1)" value={config.net1} />
                                <DetailItem label="Primary Disk" value={config.scsi0 || config.rootfs} />
                                <DetailItem label="Cloud-Init User" value={config.ciuser} />
                            </Grid.Col>
                        </Grid>
                    </Box>
                </Stack>
            )}
        </Modal>
    );
}
