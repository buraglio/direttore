import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
    Box, Title, Text, Stepper, Button, Group, Select, TextInput,
    NumberInput, Paper, Stack, Badge, Progress, Alert, Divider,
    ActionIcon, Tooltip, Table, ThemeIcon,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
    IconServer, IconBox, IconCheck, IconX, IconRocket,
    IconPlus, IconTrash, IconNetwork, IconDatabase, IconCloud,
} from '@tabler/icons-react';
import {
    getNodes, getTemplates, getNetworks, getStorage,
    createVM, createContainer, pollTask,
} from '../api/proxmox';
import NetBoxNicPicker from '../components/NetBoxNicPicker';


const VMID_DEFAULT = 1000 + Math.floor(Math.random() * 8000);

const NIC_MODELS = [
    { value: 'virtio', label: 'VirtIO (recommended)' },
    { value: 'e1000', label: 'Intel E1000' },
    { value: 'rtl8139', label: 'Realtek RTL8139' },
];

function bytesToGB(bytes) {
    return bytes ? (bytes / 1_073_741_824).toFixed(0) : '?';
}

// ── NIC card component ────────────────────────────────────────────────────────
function NicCard({ nic, index, onUpdate, onRemove, canRemove, bridgeOptions, isVM, onPickNetBox }) {
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

// ── Main component ────────────────────────────────────────────────────────────
export default function Provision() {
    const [step, setStep] = useState(0);
    const [type, setType] = useState('vm');     // 'vm' | 'lxc'
    const [activeNode, setActiveNode] = useState(null);
    const [upid, setUpid] = useState(null);
    const [taskStatus, setTaskStatus] = useState(null);
    const [progress, setProgress] = useState(0);
    const [pickerNic, setPickerNic] = useState(null); // index of NIC being edited via NetBox
    const pollRef = useRef(null);

    const nodesQ = useQuery({ queryKey: ['nodes'], queryFn: getNodes });
    const nodes = nodesQ.data || [];
    const node = activeNode || nodes[0]?.node;

    const templatesQ = useQuery({
        queryKey: ['templates', node], queryFn: () => getTemplates(node),
        enabled: !!node && step === 1,
    });

    const networksQ = useQuery({
        queryKey: ['networks', node], queryFn: () => getNetworks(node),
        enabled: !!node && step === 3,
    });

    const storageQ = useQuery({
        queryKey: ['storage', node], queryFn: () => getStorage(node),
        enabled: !!node && step === 3,
    });

    // Default NIC shape — shared fields for both VM and LXC
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
            vmid: VMID_DEFAULT,
            name: '',
            cores: 2,
            memory: 2048,
            disk: 32,
            template: '',
            password: 'lab123',
            storage: 'local-lvm',
            nics: [defaultNic('vm')],
        },
    });

    // Reset NICs when resource type changes
    useEffect(() => {
        form.setFieldValue('nics', [defaultNic(type)]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type]);

    // Pre-select first available storage/bridge when data loads
    useEffect(() => {
        const pools = storageQ.data || [];
        if (pools.length && !pools.find(p => p.storage === form.values.storage)) {
            form.setFieldValue('storage', pools[0].storage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageQ.data]);

    useEffect(() => {
        const bridges = networksQ.data || [];
        if (bridges.length) {
            form.setFieldValue('nics', form.values.nics.map(nic => ({
                ...nic,
                bridge: bridges.find(b => b.iface === nic.bridge) ? nic.bridge : bridges[0].iface,
            })));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [networksQ.data]);

    // ── Task polling ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (upid && node && taskStatus === 'running') {
            let ticks = 0;
            pollRef.current = setInterval(async () => {
                ticks++;
                setProgress(Math.min(ticks * 12, 92));
                try {
                    const res = await pollTask(node, upid);
                    if (res.status === 'stopped') {
                        clearInterval(pollRef.current);
                        setProgress(100);
                        setTaskStatus(res.exitstatus === 'OK' ? 'done' : 'error');
                    }
                } catch {
                    clearInterval(pollRef.current);
                    setTaskStatus('error');
                }
            }, 1200);
        }
        return () => clearInterval(pollRef.current);
    }, [upid, node, taskStatus]);

    // ── Submission ────────────────────────────────────────────────────────────
    const submitMutation = useMutation({
        mutationFn: (values) => {
            const base = {
                vmid: values.vmid,
                cores: values.cores,
                memory: values.memory,
                storage: values.storage,
                nics: values.nics,
            };
            if (type === 'vm') {
                return createVM(node, {
                    ...base,
                    name: values.name,
                    disk: `${values.disk}G`,
                    iso: values.template || undefined,
                });
            } else {
                return createContainer(node, {
                    ...base,
                    hostname: values.name,
                    disk_size: values.disk,
                    template: values.template,
                    password: values.password,
                    start_after_create: true,
                });
            }
        },
        onSuccess: (data) => {
            setUpid(data.upid);
            setTaskStatus('running');
            setProgress(5);
            setStep(5);
        },
        onError: (e) => {
            notifications.show({ color: 'red', title: 'Provision failed', message: e.message });
        },
    });

    // ── Derived data ──────────────────────────────────────────────────────────
    const rawTemplates = templatesQ.data || [];
    const templateOptions = rawTemplates
        .filter(t => type === 'lxc' ? t.content === 'vztmpl' : t.content === 'iso')
        .map(t => ({ value: t.volid, label: t.volid.split('/').pop() }));

    const nodeOptions = nodes.map(n => ({ value: n.node, label: n.node }));

    const bridgeOptions = (networksQ.data || []).map(n => ({
        value: n.iface,
        label: n.comments ? `${n.iface} — ${n.comments}` : n.iface,
        disabled: !n.active,
    }));

    const storageOptions = (storageQ.data || []).map(s => ({
        value: s.storage,
        label: `${s.storage} (${s.type}) — ${bytesToGB(s.avail)} GB free`,
    }));

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

    // Apply a partial NIC patch coming back from the NetBox picker.
    // Use per-field path updates (nics.N.field) instead of replacing the whole
    // nics array — this is more reliable with Mantine's form state tracking and
    // avoids any stale-closure issue where form.values.nics was captured before
    // the latest render.
    const applyNetBoxPick = (patch) => {
        if (pickerNic === null) return;
        Object.entries(patch).forEach(([key, value]) => {
            form.setFieldValue(`nics.${pickerNic}.${key}`, value);
        });
    };

    // ── Review summary rows ───────────────────────────────────────────────────
    const reviewRows = [
            ['Type', type === 'vm' ? 'Virtual Machine (QEMU)' : 'LXC Container'],
            ['Node', node],
            [type === 'lxc' ? 'Hostname' : 'Name', form.values.name],
            ['VMID', form.values.vmid],
            ['CPU', `${form.values.cores} vCPU`],
            ['RAM', `${form.values.memory} MB`],
            ['Disk', `${form.values.disk} GB`],
            ['Storage', form.values.storage],
            ['Template', form.values.template ? form.values.template.split('/').pop() : 'none'],
        ];

        return (
            <Box>
                <Title order={2} mb={4} style={{ color: 'var(--text)' }}>Provision Resource</Title>
                <Text c="dimmed" size="sm" mb="xl">Create a VM or LXC container on a Proxmox node</Text>

                <Paper p="xl" radius="md" style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: 780 }}>
                    <Stepper active={step} color="cyan" size="sm" mb="xl">
                        <Stepper.Step label="Type" description="VM or LXC" />
                        <Stepper.Step label="Template" description="OS image" />
                        <Stepper.Step label="Resources" description="CPU / RAM / disk" />
                        <Stepper.Step label="Network & Storage" description="NICs, VLAN, pool" />
                        <Stepper.Step label="Review" description="Confirm" />
                        <Stepper.Step label="Progress" description="Provisioning" />
                    </Stepper>

                    {/* ──────────── Step 0: Type ──────────── */}
                    {step === 0 && (
                        <Stack gap="md">
                            <Select label="Proxmox node" data={nodeOptions} value={node} onChange={setActiveNode} />
                            <Text size="sm" fw={500} mt="xs">Resource type</Text>
                            <Group grow>
                                {[
                                    { key: 'vm', Icon: IconServer, label: 'Virtual Machine', sub: 'QEMU/KVM full virtualization' },
                                    { key: 'lxc', Icon: IconBox, label: 'LXC Container', sub: 'Lightweight OS container' },
                                ].map(({ key, Icon, label, sub }) => (
                                    <Paper key={key} p="md" radius="md" withBorder onClick={() => setType(key)}
                                        style={{
                                            cursor: 'pointer',
                                            border: `2px solid ${type === key ? 'var(--cyan)' : 'var(--border)'}`,
                                            background: type === key ? 'rgba(0,188,212,0.07)' : 'var(--surface2)',
                                            transition: 'all 0.15s',
                                        }}>
                                        <Group gap="xs" justify="center">
                                            <Icon size={24} color={type === key ? 'var(--cyan)' : 'var(--muted)'} />
                                            <Stack gap={0}>
                                                <Text size="sm" fw={600}>{label}</Text>
                                                <Text size="xs" c="dimmed">{sub}</Text>
                                            </Stack>
                                        </Group>
                                    </Paper>
                                ))}
                            </Group>
                            <Group justify="flex-end" mt="md">
                                <Button color="cyan" onClick={() => setStep(1)}>Next</Button>
                            </Group>
                        </Stack>
                    )}

                    {/* ──────────── Step 1: Template ──────────── */}
                    {step === 1 && (
                        <Stack gap="md">
                            <Select
                                label={type === 'lxc' ? 'Container Template' : 'ISO Image'}
                                description={type === 'lxc' ? 'LXC .tar.gz template' : 'Bootable ISO'}
                                data={templateOptions}
                                value={form.values.template}
                                onChange={(v) => form.setFieldValue('template', v)}
                                searchable
                                placeholder={templatesQ.isLoading ? 'Loading…' : 'Select a template'}
                            />
                            {templateOptions.length === 0 && !templatesQ.isLoading && (
                                <Alert color="yellow" size="sm">
                                    No {type === 'lxc' ? 'container templates' : 'ISOs'} found on {node}.
                                    In mock mode this is expected.
                                </Alert>
                            )}
                            <Group justify="space-between" mt="md">
                                <Button variant="subtle" onClick={() => setStep(0)}>Back</Button>
                                <Button color="cyan" onClick={() => setStep(2)}>Next</Button>
                            </Group>
                        </Stack>
                    )}

                    {/* ──────────── Step 2: Resources ──────────── */}
                    {step === 2 && (
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
                            <Group justify="space-between" mt="md">
                                <Button variant="subtle" onClick={() => setStep(1)}>Back</Button>
                                <Button color="cyan" disabled={!form.values.name.trim()} onClick={() => setStep(3)}>Next</Button>
                            </Group>
                        </Stack>
                    )}

                    {/* ──────────── Step 3: Network & Storage ──────────── */}
                    {step === 3 && (
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
                                    placeholder={storageQ.isLoading ? 'Loading storage…' : 'Select storage pool'}
                                    searchable
                                />
                                {storageOptions.length === 0 && !storageQ.isLoading && (
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

                                {networksQ.isLoading && (
                                    <Text size="xs" c="dimmed">Loading bridges…</Text>
                                )}
                                {bridgeOptions.length === 0 && !networksQ.isLoading && (
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
                                            onPickNetBox={() => setPickerNic(idx)}
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

                            <Group justify="space-between" mt="md">
                                <Button variant="subtle" onClick={() => setStep(2)}>Back</Button>
                                <Button color="cyan" onClick={() => setStep(4)}>Next</Button>
                            </Group>
                        </Stack>
                    )}

                    {/* ──────────── Step 4: Review ──────────── */}
                    {step === 4 && (
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

                            <Group justify="space-between" mt="md">
                                <Button variant="subtle" onClick={() => setStep(3)}>Back</Button>
                                <Button
                                    color="cyan"
                                    leftSection={<IconRocket size={14} />}
                                    loading={submitMutation.isPending}
                                    onClick={() => submitMutation.mutate(form.values)}
                                >
                                    Provision
                                </Button>
                            </Group>
                        </Stack>
                    )}

                    {/* ──────────── Step 5: Progress ──────────── */}
                    {step === 5 && (
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
                                    <Button color="cyan" onClick={() => {
                                        setStep(0);
                                        form.reset();
                                        form.setFieldValue('nics', [defaultNic(type)]);
                                        setUpid(null);
                                        setTaskStatus(null);
                                        setProgress(0);
                                    }}>
                                        Provision Another
                                    </Button>
                                </>
                            )}
                            {taskStatus === 'error' && (
                                <>
                                    <Badge size="xl" color="red" leftSection={<IconX size={14} />}>Failed</Badge>
                                    <Text size="sm" c="red">The provisioning task failed. Check the Proxmox task log.</Text>
                                    <Button variant="subtle" onClick={() => setStep(4)}>Go Back</Button>
                                </>
                            )}
                        </Stack>
                    )}
                </Paper>

                {/* NetBox NIC picker modal */}
                <NetBoxNicPicker
                    opened={pickerNic !== null}
                    onClose={() => setPickerNic(null)}
                    onApply={applyNetBoxPick}
                    nicIndex={pickerNic ?? 0}
                />
            </Box>
        );
    }
