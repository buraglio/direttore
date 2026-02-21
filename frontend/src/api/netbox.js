import client from './client';

/** Check if the configured NetBox instance is reachable. */
export const checkNetBoxStatus = () =>
    client.get('/api/inventory/netbox-status').then(r => r.data);

/**
 * Fetch IP addresses from NetBox.
 * @param {Object} params - Optional filters: family (4|6), status, prefix, dns_name, limit
 */
export const getIPAddresses = (params = {}) =>
    client.get('/api/inventory/ip-addresses', { params }).then(r => r.data);

/**
 * Fetch IP prefixes from NetBox.
 * @param {Object} params - Optional filters: family (4|6), status, site, limit
 */
export const getPrefixes = (params = {}) =>
    client.get('/api/inventory/prefixes', { params }).then(r => r.data);

/**
 * Fetch VLANs from NetBox.
 * @param {Object} params - Optional filters: site, group, role, status, q, limit
 */
export const getVlans = (params = {}) =>
    client.get('/api/inventory/vlans', { params }).then(r => r.data);
