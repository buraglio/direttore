import { Stack, Text, Progress, Badge, Button } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';

export function ProgressStep({
    type,
    taskStatus,
    progress,
    upid,
    form,
    node,
    onReset,
    onBack
}) {
    return (
        <Stack gap="lg" align="center" py="md">
            {taskStatus === 'running' && (
                <>
                    <Text fw={600}>Provisioning {type === 'vm' ? 'VM' : 'container'}…</Text>
                    <Progress value={progress} color="cyan" animated w="100%" size="lg" radius="xl" />
                    <Text size="xs" c="dimmed">UPID: {upid}</Text>
                </>
            )}
            {taskStatus === 'done' && (
                <>
                    <Badge size="xl" color="green" leftSection={<IconCheck size={14} />}>Success</Badge>
                    <Text size="sm" c="dimmed">
                        {type === 'vm' ? 'VM' : 'Container'} <strong>{form.values.name}</strong> (VMID {form.values.vmid}) provisioned on <strong>{node}</strong>.
                    </Text>
                    <Button color="cyan" onClick={onReset}>
                        Provision Another
                    </Button>
                </>
            )}
            {taskStatus === 'error' && (
                <>
                    <Badge size="xl" color="red" leftSection={<IconX size={14} />}>Failed</Badge>
                    <Text size="sm" c="red">The provisioning task failed. Check the Proxmox task log.</Text>
                    <Button variant="subtle" onClick={onBack}>Go Back</Button>
                </>
            )}
        </Stack>
    );
}
