import { Paper, Group, ThemeIcon, Text, Tooltip, ActionIcon, Select, NumberInput, TextInput } from '@mantine/core';
import { IconNetwork, IconTrash, IconCloud } from '@tabler/icons-react';
import { NIC_MODELS } from '../utils/formatters';

export function NicCard({ nic, index, onUpdate, onRemove, canRemove, bridgeOptions, isVM, onPickNetBox }) {
    return (
        <Paper p="md" radius="md" withBorder style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}>
            <Group justify="space-between" mb="sm">
                <Group gap="xs">
                    <ThemeIcon size="sm" color="cyan" variant="light">
                        <IconNetwork size={12} />
                    </ThemeIcon>
                    <Text size="sm" fw={600}>Interface {index} {index === 0 ? '(primary)' : ''}</Text>
                </Group>
                {canRemove && (
                    <Tooltip label="Remove interface">
                        <ActionIcon color="red" variant="subtle" size="sm" onClick={onRemove}>
                            <IconTrash size={14} />
                        </ActionIcon>
                    </Tooltip>
                )}
                <Tooltip label="Populate from NetBox">
                    <ActionIcon color="cyan" variant="subtle" size="sm" onClick={onPickNetBox}>
                        <IconCloud size={14} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            {/* Row 1: Bridge / VLAN / NIC model */}
            <Group grow gap="sm" mb="sm">
                <Select
                    label="Bridge"
                    data={bridgeOptions}
                    value={nic.bridge}
                    onChange={(v) => onUpdate({ ...nic, bridge: v })}
                    placeholder="Select bridge"
                />
                <NumberInput
                    label="VLAN ID"
                    description="Leave empty for untagged"
                    placeholder="None"
                    min={1}
                    max={4094}
                    value={nic.vlan ?? ''}
                    onChange={(v) => onUpdate({ ...nic, vlan: v === '' ? null : Number(v) })}
                    allowDecimal={false}
                    clearable
                />
                {isVM && (
                    <Select
                        label="NIC Model"
                        data={NIC_MODELS}
                        value={nic.model}
                        onChange={(v) => onUpdate({ ...nic, model: v })}
                    />
                )}
            </Group>

            {/* Row 2: IPv4 address + IPv4 default gateway */}
            <Group grow gap="sm" mb="sm">
                <TextInput
                    label="IPv4 / CIDR"
                    description='e.g. "dhcp" or "10.0.0.5/24"'
                    placeholder="dhcp"
                    value={nic.ip}
                    onChange={(e) => onUpdate({ ...nic, ip: e.currentTarget.value })}
                />
                <TextInput
                    label="IPv4 Default Gateway"
                    description="Leave empty for none"
                    placeholder="10.0.0.1"
                    value={nic.gw}
                    onChange={(e) => onUpdate({ ...nic, gw: e.currentTarget.value })}
                />
            </Group>

            {/* Row 3: IPv6 address + IPv6 default gateway */}
            <Group grow gap="sm" mb="sm">
                <TextInput
                    label="IPv6 / Prefix"
                    description='e.g. "auto" or "2001:db8::5/64"'
                    placeholder="auto"
                    value={nic.ip6}
                    onChange={(e) => onUpdate({ ...nic, ip6: e.currentTarget.value })}
                />
                <TextInput
                    label="IPv6 Default Gateway"
                    description="Leave empty for none"
                    placeholder="2001:db8::1"
                    value={nic.gw6}
                    onChange={(e) => onUpdate({ ...nic, gw6: e.currentTarget.value })}
                />
            </Group>

            {/* Row 4: DNS servers */}
            <TextInput
                label="DNS Servers"
                description="Space-separated, e.g. 1.1.1.1 2606:4700:4700::1111"
                placeholder="1.1.1.1 8.8.8.8"
                value={nic.dns}
                onChange={(e) => onUpdate({ ...nic, dns: e.currentTarget.value })}
            />
        </Paper>
    );
}
