import client from './client';

export const getNodes = () => client.get('/api/proxmox/nodes').then(r => r.data);

export const getVMs = (node) => client.get(`/api/proxmox/nodes/${node}/vms`).then(r => r.data);

export const getContainers = (node) => client.get(`/api/proxmox/nodes/${node}/lxc`).then(r => r.data);

export const getTemplates = (node) => client.get(`/api/proxmox/nodes/${node}/templates`).then(r => r.data);

export const getNetworks = (node) => client.get(`/api/proxmox/nodes/${node}/networks`).then(r => r.data);

export const getStorage = (node) => client.get(`/api/proxmox/nodes/${node}/storage`).then(r => r.data);

export const createVM = (node, payload) =>
    client.post(`/api/proxmox/nodes/${node}/vms`, payload).then(r => r.data);

export const createContainer = (node, payload) =>
    client.post(`/api/proxmox/nodes/${node}/lxc`, payload).then(r => r.data);

export const vmAction = (node, vmid, action) =>
    client.post(`/api/proxmox/nodes/${node}/vms/${vmid}/${action}`).then(r => r.data);

export const containerAction = (node, vmid, action) =>
    client.post(`/api/proxmox/nodes/${node}/lxc/${vmid}/${action}`).then(r => r.data);

export const pollTask = (node, upid) =>
    client.get(`/api/proxmox/tasks/${node}/${encodeURIComponent(upid)}`).then(r => r.data);
