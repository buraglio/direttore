import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Box, Title, Text, Modal, TextInput, Select, Textarea,
    Button, Group, Stack, Paper, Badge, Alert,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { getReservations, createReservation, cancelReservation } from '../api/reservations';
import { getNodes } from '../api/proxmox';
import dayjs from 'dayjs';

function useReservations() {
    return useQuery({
        queryKey: ['reservations'],
        queryFn: () => getReservations(),
        refetchInterval: 30000,
    });
}

function toFCEvents(reservations) {
    const colors = { vm: '#0097a7', lxc: '#6a1b9a' };
    return (reservations || []).map(r => ({
        id: String(r.id),
        title: `${r.resource_type.toUpperCase()}: ${r.title}`,
        start: r.start_dt,
        end: r.end_dt,
        backgroundColor: colors[r.resource_type] || '#0097a7',
        borderColor: r.status === 'cancelled' ? '#888' : undefined,
        extendedProps: r,
    }));
}

export default function Reservations() {
    const qc = useQueryClient();
    const resQ = useReservations();
    const nodesQ = useQuery({ queryKey: ['nodes'], queryFn: getNodes });

    const [newModal, setNewModal] = useState(false);
    const [detailModal, setDetailModal] = useState(null); // selected reservation
    const [newSlot, setNewSlot] = useState({ start: null, end: null });

    const form = useForm({
        initialValues: {
            title: '',
            requester: '',
            resource_type: 'vm',
            proxmox_node: '',
            start_dt: null,
            end_dt: null,
            notes: '',
        },
        validate: {
            title: (v) => (!v.trim() ? 'Title is required' : null),
            start_dt: (v) => (!v ? 'Start time required' : null),
            end_dt: (v, vals) => (!v ? 'End time required' : dayjs(v).isBefore(vals.start_dt) ? 'Must be after start' : null),
        },
    });

    const createMut = useMutation({
        mutationFn: createReservation,
        onSuccess: () => {
            notifications.show({ color: 'green', title: 'Reserved', message: 'Reservation created successfully' });
            qc.invalidateQueries(['reservations']);
            setNewModal(false);
            form.reset();
        },
        onError: (e) => {
            const msg = e.response?.data?.detail || e.message;
            notifications.show({ color: 'red', title: 'Conflict or error', message: msg });
        },
    });

    const cancelMut = useMutation({
        mutationFn: cancelReservation,
        onSuccess: () => {
            notifications.show({ color: 'orange', title: 'Cancelled', message: 'Reservation cancelled' });
            qc.invalidateQueries(['reservations']);
            setDetailModal(null);
        },
    });

    const handleDateSelect = useCallback((selectInfo) => {
        form.setValues({
            ...form.values,
            start_dt: new Date(selectInfo.startStr),
            end_dt: new Date(selectInfo.endStr),
        });
        setNewModal(true);
    }, []);

    const handleEventClick = useCallback((clickInfo) => {
        setDetailModal(clickInfo.event.extendedProps);
    }, []);

    const nodeOptions = (nodesQ.data || []).map(n => ({ value: n.node, label: n.node }));

    return (
        <Box>
            <Group justify="space-between" mb="md">
                <Box>
                    <Title order={2} mb={2} style={{ color: 'var(--text)' }}>Reservations</Title>
                    <Text c="dimmed" size="sm">Schedule and manage lab resource time slots</Text>
                </Box>
                <Button color="cyan" onClick={() => setNewModal(true)}>+ New Reservation</Button>
            </Group>

            <Paper p="md" radius="md" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <FullCalendar
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                    initialView="timeGridWeek"
                    headerToolbar={{
                        left: 'prev,next today',
                        center: 'title',
                        right: 'dayGridMonth,timeGridWeek,timeGridDay',
                    }}
                    height="600px"
                    selectable
                    selectMirror
                    events={toFCEvents(resQ.data)}
                    select={handleDateSelect}
                    eventClick={handleEventClick}
                />
            </Paper>

            {/* -------- New Reservation Modal -------- */}
            <Modal
                opened={newModal}
                onClose={() => { setNewModal(false); form.reset(); }}
                title={<Text fw={600}>New Reservation</Text>}
                size="md"
                styles={{ content: { background: 'var(--surface)' }, header: { background: 'var(--surface)' } }}
            >
                <form onSubmit={form.onSubmit((vals) => createMut.mutate({
                    ...vals,
                    start_dt: vals.start_dt?.toISOString(),
                    end_dt: vals.end_dt?.toISOString(),
                }))}>
                    <Stack gap="sm">
                        <TextInput label="Title" placeholder="BGP lab session" {...form.getInputProps('title')} />
                        <TextInput label="Requester" placeholder="your name / team" {...form.getInputProps('requester')} />
                        <Group grow>
                            <Select
                                label="Type"
                                data={[{ value: 'vm', label: 'VM' }, { value: 'lxc', label: 'LXC Container' }]}
                                {...form.getInputProps('resource_type')}
                            />
                            <Select
                                label="Node (optional)"
                                data={nodeOptions}
                                clearable
                                {...form.getInputProps('proxmox_node')}
                            />
                        </Group>
                        <Group grow>
                            <DateTimePicker
                                label="Start"
                                valueFormat="YYYY-MM-DD HH:mm"
                                {...form.getInputProps('start_dt')}
                            />
                            <DateTimePicker
                                label="End"
                                valueFormat="YYYY-MM-DD HH:mm"
                                {...form.getInputProps('end_dt')}
                            />
                        </Group>
                        <Textarea label="Notes (optional)" rows={2} {...form.getInputProps('notes')} />
                        <Group justify="flex-end" mt="xs">
                            <Button variant="subtle" onClick={() => { setNewModal(false); form.reset(); }}>Cancel</Button>
                            <Button type="submit" color="cyan" loading={createMut.isPending}>Reserve</Button>
                        </Group>
                    </Stack>
                </form>
            </Modal>

            {/* -------- Detail Modal -------- */}
            {detailModal && (
                <Modal
                    opened={!!detailModal}
                    onClose={() => setDetailModal(null)}
                    title={<Text fw={600}>{detailModal.title}</Text>}
                    size="sm"
                    styles={{ content: { background: 'var(--surface)' }, header: { background: 'var(--surface)' } }}
                >
                    <Stack gap="xs">
                        {[
                            ['Requester', detailModal.requester],
                            ['Type', detailModal.resource_type],
                            ['Node', detailModal.proxmox_node || '—'],
                            ['VMID', detailModal.vmid || '—'],
                            ['Start', dayjs(detailModal.start_dt).format('YYYY-MM-DD HH:mm')],
                            ['End', dayjs(detailModal.end_dt).format('YYYY-MM-DD HH:mm')],
                            ['Status', detailModal.status],
                        ].map(([k, v]) => (
                            <Group key={k} justify="space-between">
                                <Text size="sm" c="dimmed">{k}</Text>
                                <Text size="sm" fw={500}>{v}</Text>
                            </Group>
                        ))}
                        {detailModal.notes && (
                            <Paper p="xs" radius="sm" style={{ background: 'var(--surface2)' }}>
                                <Text size="xs" c="dimmed">{detailModal.notes}</Text>
                            </Paper>
                        )}
                        {detailModal.status !== 'cancelled' && (
                            <Group justify="flex-end" mt="sm">
                                <Button
                                    color="red" variant="light" size="sm"
                                    loading={cancelMut.isPending}
                                    onClick={() => cancelMut.mutate(detailModal.id)}
                                >
                                    Cancel Reservation
                                </Button>
                            </Group>
                        )}
                    </Stack>
                </Modal>
            )}
        </Box>
    );
}
