import client from './client';

export const getReservations = (params) =>
    client.get('/api/reservations/', { params }).then(r => r.data);

export const createReservation = (payload) =>
    client.post('/api/reservations/', payload).then(r => r.data);

export const cancelReservation = (id) =>
    client.delete(`/api/reservations/${id}`).then(r => r.data);

export const updateReservation = (id, payload) =>
    client.patch(`/api/reservations/${id}`, payload).then(r => r.data);
