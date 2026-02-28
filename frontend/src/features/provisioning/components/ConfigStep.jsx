import { Stack, Box, Group, ThemeIcon, Text, Select, Alert, Divider, Badge, Button } from '@mantine/core';
import { IconDatabase, IconNetwork, IconPlus } from '@tabler/icons-react';
import { NicCard } from './NicCard';

export function ConfigStep({
    form,
    type,
    storageOptions,
    isLoadingStorage,
    bridgeOptions,
    isLoadingNetworks,
    addNic,
    updateNic,
    removeNic,
    onPickNetBox
}) {
    return (
        <Stack gap="lg">
            {/* Storage */}
            <Box>
                <Group gap="xs" mb="sm">
                    <ThemeIcon size="sm" color="teal" variant="light">
                        <IconDatabase size={12} />
                    </ThemeIcon>
                    <Text size="sm" fw={600}>Storage Pool</Text>
                </Group>
                <Select
                    label="Disk storage"
                    description="Where the VM disk or LXC rootfs will be created"
                    data={storageOptions}
                    value={form.values.storage}
                    onChange={(v) => form.setFieldValue('storage', v)}
                    placeholder={isLoadingStorage ? 'Loading storage…' : 'Select storage pool'}
                    searchable
                />
                {storageOptions.length === 0 && !isLoadingStorage && (
                    <Alert color="yellow" size="sm" mt="xs">
                        No storage pools found for this node. Check the API or mock data.
                    </Alert>
                )}
            </Box>

            <Divider />

            {/* NICs */}
            <Box>
                <Group gap="xs" mb="sm">
                    <ThemeIcon size="sm" color="cyan" variant="light">
                        <IconNetwork size={12} />
                    </ThemeIcon>
                    <Text size="sm" fw={600}>Network Interfaces</Text>
                    <Badge size="xs" variant="light" color="gray">{form.values.nics.length} / 8</Badge>
                </Group>

                {isLoadingNetworks && (
                    <Text size="xs" c="dimmed">Loading bridges…</Text>
                )}
                {bridgeOptions.length === 0 && !isLoadingNetworks && (
                    <Alert color="yellow" size="sm" mb="sm">
                        No bridges found. Check node networks or mock data.
                    </Alert>
                )}

                <Stack gap="sm">
                    {form.values.nics.map((nic, idx) => (
                        <NicCard
                            key={idx}
                            nic={nic}
                            index={idx}
                            onUpdate={(updated) => updateNic(idx, updated)}
                            onRemove={() => removeNic(idx)}
                            canRemove={form.values.nics.length > 1}
                            bridgeOptions={bridgeOptions.length ? bridgeOptions : [{ value: nic.bridge, label: nic.bridge }]}
                            isVM={type === 'vm'}
                            onPickNetBox={() => onPickNetBox(idx)}
                        />
                    ))}
                </Stack>

                {form.values.nics.length < 8 && (
                    <Button
                        mt="sm"
                        variant="light"
                        color="cyan"
                        size="xs"
                        leftSection={<IconPlus size={12} />}
                        onClick={addNic}
                    >
                        Add Network Interface
                    </Button>
                )}
            </Box>
        </Stack>
    );
}
