import { Stack, TextInput, PasswordInput, Textarea, Text } from '@mantine/core';

export function UserStep({ form, type }) {
    return (
        <Stack gap="md">
            {type === 'vm' && (
                <>
                    <TextInput
                        label="Username"
                        description="Cloud-Init default login user (e.g. ubuntu)"
                        placeholder="e.g. ubuntu"
                        {...form.getInputProps('username')}
                    />
                    <PasswordInput
                        label="Password"
                        description="VM Cloud-Init user password"
                        placeholder="Leave blank for none"
                        {...form.getInputProps('password')}
                    />
                    <Textarea
                        label="SSH Public Key"
                        description="Used for Cloud-Init VM authorized_keys setup"
                        placeholder="ssh-rsa AAAA..."
                        rows={4}
                        {...form.getInputProps('sshKey')}
                    />
                </>
            )}

            {type === 'lxc' && (
                <Text size="sm" c="dimmed" mt="xs">
                    LXC containers are seeded directly by the hypervisor Template without intermediate Cloud-Init steps. Connections authenticate directly to the <b>root</b> account, where the password is configured in the next step.
                </Text>
            )}
        </Stack>
    );
}
