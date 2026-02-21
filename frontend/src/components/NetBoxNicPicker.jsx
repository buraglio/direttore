import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Modal, Tabs, TextInput, Table, Badge, Alert, Loader, Stack, Group,
    Text, Button, ActionIcon, Tooltip, SegmentedControl, ThemeIcon,
    ScrollArea,
} from '@mantine/core';
import {
    IconCloud, IconAlertTriangle, IconCheck, IconNetwork,
    IconSearch, IconLayersLinked,
} from '@tabler/icons-react';
import { checkNetBoxStatus, getIPAddresses, getPrefixes, getVlans } from '../api/netbox';

// ── helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS = { active: 'green', reserved: 'yellow', deprecated: 'red', available: 'blue' };

function StatusBadge({ status }) {
    return (
        <Badge size="xs" color={STATUS_COLORS[status] || 'gray'} variant="light">
            {status || '—'}
        </Badge>
    );
}

function useNetBoxStatus() {
    return useQuery({
        queryKey: ['netbox-status'],
        queryFn: checkNetBoxStatus,
        staleTime: 30_000,
        retry: false,
    });
}

function search(rows, q, keys) {
    if (!q) return rows;
    const lc = q.toLowerCase();
    return rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(lc)));
}

// ── IP Addresses tab ─────────────────────────────────────────────────────────

function IPAddressesTab({ onSelect }) {
    const [q, setQ] = useState('');
    const [family, setFamily] = useState('both');

    const params = {
        status: 'active',
        ...(family !== 'both' ? { family: Number(family) } : {}),
    };

    const { data = [], isLoading, isError } = useQuery({
        queryKey: ['nb-ip-addresses', family],
        queryFn: () => getIPAddresses(params),
        staleTime: 60_000,
    });

    const rows = search(data, q, ['address', 'dns_name', 'description', 'vrf']);

    return (
        <Stack gap="sm">
            <Group grow>
                <TextInput
                    placeholder="Search address, DNS name…"
                    leftSection={<IconSearch size={14} />}
                    value={q}
                    onChange={e => setQ(e.currentTarget.value)}
                    size="xs"
                />
                <SegmentedControl
                    size="xs"
                    value={family}
                    onChange={setFamily}
                    data={[
                        { label: 'Both', value: 'both' },
                        { label: 'IPv4', value: '4' },
                        { label: 'IPv6', value: '6' },
                    ]}
                />
            </Group>

            {isLoading && <Group justify="center" py="md"><Loader size="sm" color="cyan" /></Group>}
            {isError && <Alert color="red" size="sm">Failed to load IP addresses from NetBox.</Alert>}

            {!isLoading && !isError && (
                <ScrollArea h={320}>
                    <Table fz="xs" withRowBorders highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Address</Table.Th>
                                <Table.Th>DNS Name</Table.Th>
                                <Table.Th>Gateway</Table.Th>
                                <Table.Th>VRF</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.length === 0 && (
                                <Table.Tr>
                                    <Table.Td colSpan={6}>
                                        <Text c="dimmed" fz="xs" ta="center">No addresses found</Text>
                                    </Table.Td>
                                </Table.Tr>
                            )}
                            {rows.map(ip => (
                                <Table.Tr key={ip.id}>
                                    <Table.Td fw={500}>{ip.address}</Table.Td>
                                    <Table.Td c="dimmed">{ip.dns_name || '—'}</Table.Td>
                                    <Table.Td>{ip.prefix_gateway || '—'}</Table.Td>
                                    <Table.Td>{ip.vrf || 'global'}</Table.Td>
                                    <Table.Td><StatusBadge status={ip.status} /></Table.Td>
                                    <Table.Td>
                                        <Button
                                            size="compact-xs"
                                            color="cyan"
                                            variant="light"
                                            leftSection={<IconCheck size={10} />}
                                            onClick={() => onSelect({ type: 'ip', data: ip })}
                                        >
                                            Use
                                        </Button>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            )}
        </Stack>
    );
}

// ── Prefixes tab ─────────────────────────────────────────────────────────────

function PrefixesTab({ onSelect }) {
    const [q, setQ] = useState('');
    const [family, setFamily] = useState('both');

    const params = {
        ...(family !== 'both' ? { family: Number(family) } : {}),
    };

    const { data = [], isLoading, isError } = useQuery({
        queryKey: ['nb-prefixes', family],
        queryFn: () => getPrefixes(params),
        staleTime: 60_000,
    });

    const rows = search(data, q, ['prefix', 'description', 'site', 'vrf', 'role']);

    return (
        <Stack gap="sm">
            <Group grow>
                <TextInput
                    placeholder="Search prefix, site, role…"
                    leftSection={<IconSearch size={14} />}
                    value={q}
                    onChange={e => setQ(e.currentTarget.value)}
                    size="xs"
                />
                <SegmentedControl
                    size="xs"
                    value={family}
                    onChange={setFamily}
                    data={[
                        { label: 'Both', value: 'both' },
                        { label: 'IPv4', value: '4' },
                        { label: 'IPv6', value: '6' },
                    ]}
                />
            </Group>

            {isLoading && <Group justify="center" py="md"><Loader size="sm" color="cyan" /></Group>}
            {isError && <Alert color="red" size="sm">Failed to load prefixes from NetBox.</Alert>}

            {!isLoading && !isError && (
                <ScrollArea h={320}>
                    <Table fz="xs" withRowBorders highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Prefix</Table.Th>
                                <Table.Th>Gateway</Table.Th>
                                <Table.Th>DNS Servers</Table.Th>
                                <Table.Th>Site / VRF</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.length === 0 && (
                                <Table.Tr>
                                    <Table.Td colSpan={6}>
                                        <Text c="dimmed" fz="xs" ta="center">No prefixes found</Text>
                                    </Table.Td>
                                </Table.Tr>
                            )}
                            {rows.map(p => (
                                <Table.Tr key={p.id}>
                                    <Table.Td fw={500}>{p.prefix}</Table.Td>
                                    <Table.Td>{p.gateway || '—'}</Table.Td>
                                    <Table.Td c="dimmed">{p.dns_servers || '—'}</Table.Td>
                                    <Table.Td c="dimmed">
                                        {[p.site, p.vrf].filter(Boolean).join(' / ') || 'global'}
                                    </Table.Td>
                                    <Table.Td><StatusBadge status={p.status} /></Table.Td>
                                    <Table.Td>
                                        <Button
                                            size="compact-xs"
                                            color="cyan"
                                            variant="light"
                                            leftSection={<IconCheck size={10} />}
                                            onClick={() => onSelect({ type: 'prefix', data: p })}
                                        >
                                            Use
                                        </Button>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            )}
        </Stack>
    );
}

// ── VLANs tab ────────────────────────────────────────────────────────────────

function VlansTab({ onSelect }) {
    const [q, setQ] = useState('');

    const { data = [], isLoading, isError } = useQuery({
        queryKey: ['nb-vlans'],
        queryFn: () => getVlans(),
        staleTime: 60_000,
    });

    const rows = search(data, q, ['name', 'description', 'site', 'group', 'role']);

    return (
        <Stack gap="sm">
            <TextInput
                placeholder="Search VLAN name, site, group…"
                leftSection={<IconSearch size={14} />}
                value={q}
                onChange={e => setQ(e.currentTarget.value)}
                size="xs"
            />

            {isLoading && <Group justify="center" py="md"><Loader size="sm" color="cyan" /></Group>}
            {isError && <Alert color="red" size="sm">Failed to load VLANs from NetBox.</Alert>}

            {!isLoading && !isError && (
                <ScrollArea h={320}>
                    <Table fz="xs" withRowBorders highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>VID</Table.Th>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>Site</Table.Th>
                                <Table.Th>Group</Table.Th>
                                <Table.Th>Role</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.length === 0 && (
                                <Table.Tr>
                                    <Table.Td colSpan={7}>
                                        <Text c="dimmed" fz="xs" ta="center">No VLANs found</Text>
                                    </Table.Td>
                                </Table.Tr>
                            )}
                            {rows.map(v => (
                                <Table.Tr key={v.id}>
                                    <Table.Td fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                        {v.vid}
                                    </Table.Td>
                                    <Table.Td>{v.name}</Table.Td>
                                    <Table.Td c="dimmed">{v.site || '—'}</Table.Td>
                                    <Table.Td c="dimmed">{v.group || '—'}</Table.Td>
                                    <Table.Td c="dimmed">{v.role || '—'}</Table.Td>
                                    <Table.Td><StatusBadge status={v.status} /></Table.Td>
                                    <Table.Td>
                                        <Button
                                            size="compact-xs"
                                            color="violet"
                                            variant="light"
                                            leftSection={<IconCheck size={10} />}
                                            onClick={() => onSelect({ type: 'vlan', data: v })}
                                        >
                                            Use
                                        </Button>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            )}
        </Stack>
    );
}

// ── Main exported component ───────────────────────────────────────────────────

/**
 * NetBoxNicPicker
 *
 * Props:
 *   opened  {bool}    - modal open state
 *   onClose {fn}      - called when modal should close
 *   onApply {fn}      - called with a NIC patch object to merge into the NIC
 *   nicIndex {number} - which interface this picker is for (display only)
 */
export default function NetBoxNicPicker({ opened, onClose, onApply, nicIndex }) {
    const statusQ = useNetBoxStatus();
    const reachable = statusQ.data?.reachable;

    const handleSelect = ({ type, data }) => {
        if (type === 'ip') {
            const isV6 = (data.family === 6);
            onApply(isV6
                ? { ip6: data.address, gw6: data.prefix_gateway || '', dns: data.dns_name || '' }
                : { ip: data.address, gw: data.prefix_gateway || '', dns: data.dns_name || '' }
            );
        } else if (type === 'prefix') {
            const isV6 = (data.family === 6);
            onApply(isV6
                ? { ip6: 'auto', gw6: data.gateway || '', dns: data.dns_servers || '' }
                : { ip: 'dhcp', gw: data.gateway || '', dns: data.dns_servers || '' }
            );
        } else if (type === 'vlan') {
            onApply({ vlan: data.vid });
        }
        onClose();
    };

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <Group gap="xs">
                    <ThemeIcon size="sm" color="cyan" variant="light">
                        <IconCloud size={14} />
                    </ThemeIcon>
                    <Text fw={600} size="sm">
                        Populate from NetBox — Interface {nicIndex}
                    </Text>
                    {statusQ.isSuccess && (
                        <Badge
                            size="xs"
                            color={reachable ? 'green' : 'red'}
                            variant="dot"
                        >
                            {reachable ? statusQ.data.version : 'unreachable'}
                        </Badge>
                    )}
                </Group>
            }
            size="xl"
            styles={{
                content: { background: 'var(--surface)', border: '1px solid var(--border)' },
                header: { background: 'var(--surface)' },
            }}
        >
            {statusQ.isLoading && (
                <Group justify="center" py="xl">
                    <Loader size="sm" color="cyan" />
                    <Text c="dimmed" size="sm">Connecting to NetBox…</Text>
                </Group>
            )}

            {statusQ.isSuccess && !reachable && (
                <Alert
                    color="yellow"
                    icon={<IconAlertTriangle size={16} />}
                    title="NetBox unreachable"
                    mb="sm"
                >
                    {statusQ.data?.reason || 'Could not connect to the configured NetBox instance.'}
                    {' '}Check <code>NETBOX_URL</code> and <code>NETBOX_TOKEN</code> in your <code>.env</code>.
                </Alert>
            )}

            {statusQ.isSuccess && reachable && (
                <Tabs defaultValue="ip" color="cyan">
                    <Tabs.List mb="sm">
                        <Tabs.Tab value="ip" leftSection={<IconNetwork size={13} />}>
                            IP Addresses
                        </Tabs.Tab>
                        <Tabs.Tab value="prefixes" leftSection={<IconNetwork size={13} />}>
                            Prefixes
                        </Tabs.Tab>
                        <Tabs.Tab value="vlans" leftSection={<IconLayersLinked size={13} />}>
                            VLANs
                        </Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="ip">
                        <IPAddressesTab onSelect={handleSelect} />
                    </Tabs.Panel>
                    <Tabs.Panel value="prefixes">
                        <PrefixesTab onSelect={handleSelect} />
                    </Tabs.Panel>
                    <Tabs.Panel value="vlans">
                        <VlansTab onSelect={handleSelect} />
                    </Tabs.Panel>
                </Tabs>
            )}
        </Modal>
    );
}
