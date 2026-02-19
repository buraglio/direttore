import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
    Box, Title, Text, Stepper, Button, Group, Select, TextInput,
    NumberInput, Paper, Stack, Badge, Progress, Alert, Radio, Divider,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
    IconServer, IconBox, IconCheck, IconX, IconRocket,
} from '@tabler/icons-react';
import { getNodes, getTemplates, createVM, createContainer, pollTask } from '../api/proxmox';

const VMID_DEFAULT = 1000 + Math.floor(Math.random() * 8000);

export default function Provision() {
    const [step, setStep] = useState(0);
    const [type, setType] = useState('vm'); // 'vm' | 'lxc'
    const [activeNode, setActiveNode] = useState(null);
    const [upid, setUpid] = useState(null);
    const [taskStatus, setTaskStatus] = useState(null); // null | 'running' | 'done' | 'error'
    const [progress, setProgress] = useState(0);
    const pollRef = useRef(null);

    const nodesQ = useQuery({ queryKey: ['nodes'], queryFn: getNodes });
    const nodes = nodesQ.data || [];
    const node = activeNode || nodes[0]?.node;

    const templatesQ = useQuery({
        queryKey: ['templates', node], queryFn: () => getTemplates(node),
        enabled: !!node && step === 1,
    });

    const form = useForm({
        initialValues: {
            vmid: VMID_DEFAULT,
            name: '',
            cores: 2,
            memory: 2048,
            disk: 32,
            template: '',
            net: 'virtio,bridge=vmbr0',
            password: 'lab123',
        },
    });

    // -----------------------------------------------------------------------
    // Task polling
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (upid && node && taskStatus === 'running') {
            let ticks = 0;
            pollRef.current = setInterval(async () => {
                ticks++;
                setProgress(Math.min(ticks * 12, 92)); // ramp up
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

    // -----------------------------------------------------------------------
    // Submission
    // -----------------------------------------------------------------------
    const submitMutation = useMutation({
        mutationFn: (values) => {
            if (type === 'vm') {
                return createVM(node, {
                    vmid: values.vmid,
                    name: values.name,
                    cores: values.cores,
                    memory: values.memory,
                    disk: `${values.disk}G`,
                    iso: values.template || undefined,
                    net0: values.net,
                });
            } else {
                return createContainer(node, {
                    vmid: values.vmid,
                    hostname: values.name,
                    cores: values.cores,
                    memory: values.memory,
                    rootfs: `local-lvm:${values.disk}`,
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
            setStep(4);
        },
        onError: (e) => {
            notifications.show({ color: 'red', title: 'Provision failed', message: e.message });
        },
    });

    // -----------------------------------------------------------------------
    // Template options
    // -----------------------------------------------------------------------
    const rawTemplates = templatesQ.data || [];
    const templateOptions = rawTemplates
        .filter(t => type === 'lxc' ? t.content === 'vztmpl' : t.content === 'iso')
        .map(t => ({ value: t.volid, label: t.volid.split('/').pop() }));

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------
    const nodeOptions = nodes.map(n => ({ value: n.node, label: n.node }));

    const isValid = () => {
        if (!form.values.name.trim()) return false;
        if (step === 1 && !form.values.template) return false;
        return true;
    };

    return (
        <Box>
            <Title order={2} mb={4} style={{ color: 'var(--text)' }}>Provision Resource</Title>
            <Text c="dimmed" size="sm" mb="xl">Create a VM or LXC container on a Proxmox node</Text>

            <Paper p="xl" radius="md" style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: 700 }}>
                <Stepper active={step} color="cyan" size="sm" mb="xl">
                    <Stepper.Step label="Type" description="VM or LXC" />
                    <Stepper.Step label="Template" description="OS image" />
                    <Stepper.Step label="Resources" description="CPU / RAM / disk" />
                    <Stepper.Step label="Review" description="Confirm" />
                    <Stepper.Step label="Progress" description="Provisioning" />
                </Stepper>

                {/* -------- Step 0: Type selection -------- */}
                {step === 0 && (
                    <Stack gap="md">
                        <Select label="Proxmox node" data={nodeOptions} value={node} onChange={setActiveNode} />

                        <Text size="sm" fw={500} mt="xs">Resource type</Text>
                        <Group grow>
                            <Paper
                                p="md" radius="md" withBorder
                                onClick={() => setType('vm')}
                                style={{
                                    cursor: 'pointer',
                                    border: `2px solid ${type === 'vm' ? 'var(--cyan)' : 'var(--border)'}`,
                                    background: type === 'vm' ? 'rgba(0,188,212,0.07)' : 'var(--surface2)',
                                    transition: 'all 0.15s',
                                }}
                            >
                                <Group gap="xs" justify="center">
                                    <IconServer size={24} color={type === 'vm' ? 'var(--cyan)' : 'var(--muted)'} />
                                    <Stack gap={0}>
                                        <Text size="sm" fw={600}>Virtual Machine</Text>
                                        <Text size="xs" c="dimmed">QEMU/KVM full virtualization</Text>
                                    </Stack>
                                </Group>
                            </Paper>
                            <Paper
                                p="md" radius="md" withBorder
                                onClick={() => setType('lxc')}
                                style={{
                                    cursor: 'pointer',
                                    border: `2px solid ${type === 'lxc' ? 'var(--cyan)' : 'var(--border)'}`,
                                    background: type === 'lxc' ? 'rgba(0,188,212,0.07)' : 'var(--surface2)',
                                    transition: 'all 0.15s',
                                }}
                            >
                                <Group gap="xs" justify="center">
                                    <IconBox size={24} color={type === 'lxc' ? 'var(--cyan)' : 'var(--muted)'} />
                                    <Stack gap={0}>
                                        <Text size="sm" fw={600}>LXC Container</Text>
                                        <Text size="xs" c="dimmed">Lightweight OS container</Text>
                                    </Stack>
                                </Group>
                            </Paper>
                        </Group>

                        <Group justify="flex-end" mt="md">
                            <Button color="cyan" onClick={() => setStep(1)}>Next</Button>
                        </Group>
                    </Stack>
                )}

                {/* -------- Step 1: Template -------- */}
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
                                No {type === 'lxc' ? 'container templates' : 'ISOs'} found on {node}. In mock mode, select any dummy item.
                            </Alert>
                        )}
                        <Group justify="space-between" mt="md">
                            <Button variant="subtle" onClick={() => setStep(0)}>Back</Button>
                            <Button color="cyan" onClick={() => setStep(2)}>Next</Button>
                        </Group>
                    </Stack>
                )}

                {/* -------- Step 2: Resources -------- */}
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

                {/* -------- Step 3: Review -------- */}
                {step === 3 && (
                    <Stack gap="md">
                        <Paper p="md" radius="md" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                            <Stack gap="xs">
                                {[
                                    ['Type', type === 'vm' ? 'Virtual Machine (QEMU)' : 'LXC Container'],
                                    ['Node', node],
                                    [type === 'lxc' ? 'Hostname' : 'Name', form.values.name],
                                    ['VMID', form.values.vmid],
                                    ['CPU', `${form.values.cores} vCPU`],
                                    ['RAM', `${form.values.memory} MB`],
                                    ['Disk', `${form.values.disk} GB`],
                                    ['Template', form.values.template ? form.values.template.split('/').pop() : 'none'],
                                ].map(([k, v]) => (
                                    <Group key={k} justify="space-between">
                                        <Text size="sm" c="dimmed">{k}</Text>
                                        <Text size="sm" fw={500}>{v}</Text>
                                    </Group>
                                ))}
                            </Stack>
                        </Paper>
                        <Group justify="space-between" mt="md">
                            <Button variant="subtle" onClick={() => setStep(2)}>Back</Button>
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

                {/* -------- Step 4: Progress -------- */}
                {step === 4 && (
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
                                <Button color="cyan" onClick={() => { setStep(0); form.reset(); setUpid(null); setTaskStatus(null); setProgress(0); }}>
                                    Provision Another
                                </Button>
                            </>
                        )}
                        {taskStatus === 'error' && (
                            <>
                                <Badge size="xl" color="red" leftSection={<IconX size={14} />}>Failed</Badge>
                                <Text size="sm" c="red">The provisioning task failed. Check the Proxmox task log.</Text>
                                <Button variant="subtle" onClick={() => setStep(3)}>Go Back</Button>
                            </>
                        )}
                    </Stack>
                )}
            </Paper>
        </Box>
    );
}
