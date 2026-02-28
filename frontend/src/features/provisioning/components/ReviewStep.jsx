import { Stack, Paper, Group, Text, Table } from '@mantine/core';

export function ReviewStep({ type, node, form, reviewRows }) {
    return (
        <Stack gap="md">
            <Paper p="md" radius="md" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <Stack gap="xs">
                    {reviewRows.map(([k, v]) => (
                        <Group key={k} justify="space-between">
                            <Text size="sm" c="dimmed">{k}</Text>
                            <Text size="sm" fw={500}>{String(v)}</Text>
                        </Group>
                    ))}
                </Stack>
            </Paper>

            <Paper p="md" radius="md" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <Text size="sm" fw={600} mb="xs">Network Interfaces</Text>
                <Table withRowBorders={false} fz="sm">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Iface</Table.Th>
                            <Table.Th>Bridge</Table.Th>
                            <Table.Th>VLAN</Table.Th>
                            {type === 'vm' && <Table.Th>Model</Table.Th>}
                            <Table.Th>IPv4</Table.Th>
                            <Table.Th>GW4</Table.Th>
                            <Table.Th>IPv6</Table.Th>
                            <Table.Th>GW6</Table.Th>
                            <Table.Th>DNS</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {form.values.nics.map((nic, idx) => (
                            <Table.Tr key={idx}>
                                <Table.Td c="dimmed">net{idx}</Table.Td>
                                <Table.Td fw={500}>{nic.bridge}</Table.Td>
                                <Table.Td>{nic.vlan ?? <Text c="dimmed" span>—</Text>}</Table.Td>
                                {type === 'vm' && <Table.Td>{nic.model}</Table.Td>}
                                <Table.Td>{nic.ip || <Text c="dimmed" span>dhcp</Text>}</Table.Td>
                                <Table.Td>{nic.gw || <Text c="dimmed" span>—</Text>}</Table.Td>
                                <Table.Td>{nic.ip6 || <Text c="dimmed" span>—</Text>}</Table.Td>
                                <Table.Td>{nic.gw6 || <Text c="dimmed" span>—</Text>}</Table.Td>
                                <Table.Td>{nic.dns || <Text c="dimmed" span>—</Text>}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Paper>
        </Stack>
    );
}
