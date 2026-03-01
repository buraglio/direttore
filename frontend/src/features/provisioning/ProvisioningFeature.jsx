import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Box, Title, Text, Stepper, Button, Group, Paper } from '@mantine/core';
import { IconRocket } from '@tabler/icons-react';

import { createVM, createContainer, pollTask } from '../../api/proxmox';
import NetBoxNicPicker from '../../components/NetBoxNicPicker';

import { useProvisioningData } from './hooks/useProvisioningData';
import { useProvisioningForm } from './hooks/useProvisioningForm';
import { bytesToGB } from './utils/formatters';

import { TypeStep } from './components/TypeStep';
import { TemplateStep } from './components/TemplateStep';
import { UserStep } from './components/UserStep';
import { ResourcesStep } from './components/ResourcesStep';
import { ConfigStep } from './components/ConfigStep';
import { ReviewStep } from './components/ReviewStep';
import { ProgressStep } from './components/ProgressStep';

export default function ProvisioningFeature() {
    const [step, setStep] = useState(0);
    const [type, setType] = useState('vm');     // 'vm' | 'lxc'
    const [activeNode, setActiveNode] = useState(null);
    const [upid, setUpid] = useState(null);
    const [taskStatus, setTaskStatus] = useState(null);
    const [progress, setProgress] = useState(0);
    const [pickerNic, setPickerNic] = useState(null); // index of NIC being edited via NetBox
    const pollRef = useRef(null);

    const provisioningData = useProvisioningData(activeNode, step);
    const nodes = provisioningData.nodes || [];
    const templates = provisioningData.templates || [];
    const isLoadingTemplates = provisioningData.isLoadingTemplates;
    const networks = provisioningData.networks || [];
    const isLoadingNetworks = provisioningData.isLoadingNetworks;
    const storage = provisioningData.storage || [];
    const isLoadingStorage = provisioningData.isLoadingStorage;

    const node = activeNode || (nodes.length > 0 ? nodes[0].node : null);

    const {
        form,
        addNic,
        updateNic,
        removeNic,
        applyNetBoxPick,
        defaultNic
    } = useProvisioningForm(type);

    // Pre-select first available storage/bridge when data loads
    useEffect(() => {
        if (storage.length && !storage.find(p => p.storage === form.values.storage)) {
            form.setFieldValue('storage', storage[0].storage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storage]);

    useEffect(() => {
        const bridges = networks || [];
        if (bridges.length) {
            form.setFieldValue('nics', form.values.nics.map(nic => ({
                ...nic,
                bridge: bridges.find(b => b.iface === nic.bridge) ? nic.bridge : bridges[0].iface,
            })));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [networks]);

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
                    username: values.username,
                    password: values.password,
                    ssh_key: values.sshKey,
                });
            } else {
                return createContainer(node, {
                    ...base,
                    hostname: values.name,
                    disk_size: values.disk,
                    template: values.template,
                    password: values.password,
                    username: values.username,
                    ssh_key: values.sshKey,
                    start_after_create: true,
                });
            }
        },
        onSuccess: (data) => {
            setUpid(data.upid);
            setTaskStatus('running');
            setProgress(5);
            setStep(6); // Step 6 is Progress now
        },
    });

    // ── Derived data ──────────────────────────────────────────────────────────
    const templateOptions = templates
        .filter(t => type === 'lxc' ? t.content === 'vztmpl' : t.content === 'iso')
        .map(t => ({ value: t.volid, label: t.volid.split('/').pop() }));

    const nodeOptions = nodes.map(n => ({ value: n.node, label: n.node }));

    const bridgeOptions = networks.map(n => ({
        value: n.iface,
        label: n.comments ? `${n.iface} — ${n.comments}` : n.iface,
        disabled: !n.active,
    }));

    const storageOptions = storage.map(s => ({
        value: s.storage,
        label: `${s.storage} (${s.type}) — ${bytesToGB(s.avail)} GB free`,
    }));

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
        ['Username', form.values.username],
        ['SSH Key', form.values.sshKey ? 'Configured' : 'None'],
    ];

    const handleReset = () => {
        setStep(0);
        form.reset();
        form.setFieldValue('nics', [defaultNic(type)]);
        setUpid(null);
        setTaskStatus(null);
        setProgress(0);
    };

    return (
        <Box>
            <Title order={2} mb={4} style={{ color: 'var(--text)' }}>Provision Resource</Title>
            <Text c="dimmed" size="sm" mb="xl">Create a VM or LXC container on a Proxmox node</Text>

            <Paper p="xl" radius="md" style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: 1200 }}>
                <Stepper active={step} color="cyan" size="sm" mb="xl">
                    <Stepper.Step label="Type" description="VM or LXC" />
                    <Stepper.Step label="Template" description="OS image" />
                    <Stepper.Step label="User" description="Credentials" />
                    <Stepper.Step label="Resources" description="CPU/RAM/disk" />
                    <Stepper.Step label="Network & Storage" description="NICs, VLAN, pool" />
                    <Stepper.Step label="Review" description="Confirm" />
                    <Stepper.Step label="Progress" description="Provisioning" />
                </Stepper>

                {/* Step 0: Type */}
                {step === 0 && (
                    <>
                        <TypeStep
                            nodeOptions={nodeOptions}
                            node={node}
                            onNodeChange={setActiveNode}
                            type={type}
                            onTypeChange={setType}
                        />
                        <Group justify="flex-end" mt="md">
                            <Button color="cyan" onClick={() => setStep(1)}>Next</Button>
                        </Group>
                    </>
                )}

                {/* Step 1: Template */}
                {step === 1 && (
                    <>
                        <TemplateStep
                            type={type}
                            node={node}
                            templateOptions={templateOptions}
                            value={form.values.template}
                            onChange={(v) => form.setFieldValue('template', v)}
                            isLoading={isLoadingTemplates}
                        />
                        <Group justify="space-between" mt="md">
                            <Button variant="subtle" onClick={() => setStep(0)}>Back</Button>
                            <Button color="cyan" disabled={!form.values.template} onClick={() => setStep(2)}>Next</Button>
                        </Group>
                    </>
                )}

                {/* Step 2: User Configuration */}
                {step === 2 && (
                    <>
                        <UserStep form={form} type={type} />
                        <Group justify="space-between" mt="md">
                            <Button variant="subtle" onClick={() => setStep(1)}>Back</Button>
                            <Button color="cyan" onClick={() => setStep(3)}>Next</Button>
                        </Group>
                    </>
                )}

                {/* Step 3: Resources */}
                {step === 3 && (
                    <>
                        <ResourcesStep type={type} form={form} />
                        <Group justify="space-between" mt="md">
                            <Button variant="subtle" onClick={() => setStep(2)}>Back</Button>
                            <Button color="cyan" disabled={!form.values.name.trim()} onClick={() => setStep(4)}>Next</Button>
                        </Group>
                    </>
                )}

                {/* Step 4: Network & Storage */}
                {step === 4 && (
                    <>
                        <ConfigStep
                            form={form}
                            type={type}
                            storageOptions={storageOptions}
                            isLoadingStorage={isLoadingStorage}
                            bridgeOptions={bridgeOptions}
                            isLoadingNetworks={isLoadingNetworks}
                            addNic={addNic}
                            updateNic={updateNic}
                            removeNic={removeNic}
                            onPickNetBox={setPickerNic}
                        />
                        <Group justify="space-between" mt="md">
                            <Button variant="subtle" onClick={() => setStep(3)}>Back</Button>
                            <Button color="cyan" onClick={() => setStep(5)}>Next</Button>
                        </Group>
                    </>
                )}

                {/* Step 5: Review */}
                {step === 5 && (
                    <>
                        <ReviewStep type={type} node={node} form={form} reviewRows={reviewRows} />
                        <Group justify="space-between" mt="md">
                            <Button variant="subtle" onClick={() => setStep(4)}>Back</Button>
                            <Button
                                color="cyan"
                                leftSection={<IconRocket size={14} />}
                                loading={submitMutation.isPending}
                                onClick={() => submitMutation.mutate(form.values)}
                            >
                                Provision
                            </Button>
                        </Group>
                    </>
                )}

                {/* Step 6: Progress */}
                {step === 6 && (
                    <ProgressStep
                        type={type}
                        taskStatus={taskStatus}
                        progress={progress}
                        upid={upid}
                        form={form}
                        node={node}
                        onReset={handleReset}
                        onBack={() => setStep(5)}
                    />
                )}
            </Paper>

            <NetBoxNicPicker
                opened={pickerNic !== null}
                onClose={() => setPickerNic(null)}
                onApply={(patch) => applyNetBoxPick(pickerNic, patch)}
                nicIndex={pickerNic ?? 0}
            />
        </Box>
    );
}
