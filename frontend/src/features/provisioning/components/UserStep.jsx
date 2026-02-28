import { Stack, TextInput, PasswordInput, Textarea } from '@mantine/core';

export function UserStep({ form }) {
    return (
        <Stack gap="md">
            <TextInput
                label="Username"
                description="Default login user (e.g. root for LXC, ubuntu for VM)"
                placeholder="e.g. ubuntu"
                {...form.getInputProps('username')}
            />

            <PasswordInput
                label="Password"
                description="Root or sudo user password"
                placeholder="Leave blank for none"
                {...form.getInputProps('password')}
            />

            <Textarea
                label="SSH Public Key"
                description="Used for cloud-init (VM) or container setup"
                placeholder="ssh-rsa AAAA..."
                rows={4}
                {...form.getInputProps('sshKey')}
            />
        </Stack>
    );
}
