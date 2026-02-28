import { Stack, Group, TextInput, NumberInput } from '@mantine/core';

export function ResourcesStep({ type, form }) {
    return (
        <Stack gap="md">
            <Group grow>
                <TextInput
                    label={type === 'lxc' ? 'Hostname' : 'VM Name'}
                    placeholder={type === 'lxc' ? 'my-container' : 'my-vm'}
                    {...form.getInputProps('name')}
                />
                <NumberInput label="VMID" min={100} max={99999} {...form.getInputProps('vmid')} />
            </Group>
            <Group grow>
                <NumberInput label="CPU cores" min={1} max={64} {...form.getInputProps('cores')} />
                <NumberInput label="RAM (MB)" min={256} step={256} max={131072} {...form.getInputProps('memory')} />
            </Group>
            <NumberInput label="Root disk (GB)" min={1} max={8192} {...form.getInputProps('disk')} />
            {type === 'lxc' && (
                <TextInput label="Root password" type="password" {...form.getInputProps('password')} />
            )}
        </Stack>
    );
}
