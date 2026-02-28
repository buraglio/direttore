export const VMID_DEFAULT = () => 1000 + Math.floor(Math.random() * 8000);

export function bytesToGB(bytes) {
    return bytes ? (bytes / 1_073_741_824).toFixed(0) : '?';
}

export const NIC_MODELS = [
    { value: 'virtio', label: 'VirtIO (recommended)' },
    { value: 'e1000', label: 'Intel E1000' },
    { value: 'rtl8139', label: 'Realtek RTL8139' },
];
