import { Stack, Select, Alert } from '@mantine/core';

export function TemplateStep({ type, node, templateOptions, value, onChange, isLoading }) {
    return (
        <Stack gap="md">
            <Select
                label={type === 'lxc' ? 'Container Template' : 'ISO Image'}
                description={type === 'lxc' ? 'LXC .tar.gz template' : 'Bootable ISO'}
                data={templateOptions}
                value={value}
                onChange={onChange}
                searchable
                placeholder={isLoading ? 'Loading…' : 'Select a template'}
            />
            {templateOptions.length === 0 && !isLoading && (
                <Alert color="yellow" size="sm">
                    No {type === 'lxc' ? 'container templates' : 'ISOs'} found on {node}.
                    In mock mode this is expected.
                </Alert>
            )}
        </Stack>
    );
}
