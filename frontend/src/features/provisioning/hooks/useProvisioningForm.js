import { useEffect } from 'react';
import { useForm } from '@mantine/form';
import { VMID_DEFAULT } from '../utils/formatters';

export function useProvisioningForm(type) {
    const defaultNic = (t) => ({
        bridge: 'vmbr0',
        vlan: null,
        model: t === 'vm' ? 'virtio' : undefined,
        ip: 'dhcp',
        gw: '',
        ip6: '',
        gw6: '',
        dns: '',
    });

    const form = useForm({
        initialValues: {
            vmid: VMID_DEFAULT(),
            name: '',
            cores: 2,
            memory: 2048,
            disk: 32,
            template: '',
            password: 'lab123',
            storage: 'local-lvm',
            nics: [defaultNic(type)],
        },
    });

    // Reset NICs when resource type changes
    useEffect(() => {
        form.setFieldValue('nics', [defaultNic(type)]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type]);

    const addNic = () => {
        if (form.values.nics.length >= 8) return;
        form.setFieldValue('nics', [
            ...form.values.nics,
            { ...defaultNic(type), ...(type === 'lxc' ? { ip: 'dhcp' } : {}), bridge: form.values.nics[0]?.bridge || 'vmbr0' },
        ]);
    };

    const updateNic = (idx, updated) => {
        const next = [...form.values.nics];
        next[idx] = updated;
        form.setFieldValue('nics', next);
    };

    const removeNic = (idx) => {
        form.setFieldValue('nics', form.values.nics.filter((_, i) => i !== idx));
    };

    const applyNetBoxPick = (pickerNic, patch) => {
        if (pickerNic === null) return;
        Object.entries(patch).forEach(([key, value]) => {
            form.setFieldValue(`nics.${pickerNic}.${key}`, value);
        });
    };

    return {
        form,
        addNic,
        updateNic,
        removeNic,
        applyNetBoxPick,
        defaultNic,
    };
}
