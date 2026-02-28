import { useQuery } from '@tanstack/react-query';
import { getNodes, getTemplates, getNetworks, getStorage } from '../../../api/proxmox';

export function useProvisioningData(node, step) {
    const nodesQ = useQuery({
        queryKey: ['nodes'],
        queryFn: getNodes
    });

    const templatesQ = useQuery({
        queryKey: ['templates', node],
        queryFn: () => getTemplates(node),
        enabled: !!node && step === 1,
    });

    const networksQ = useQuery({
        queryKey: ['networks', node],
        queryFn: () => getNetworks(node),
        enabled: !!node && step === 3,
    });

    const storageQ = useQuery({
        queryKey: ['storage', node],
        queryFn: () => getStorage(node),
        enabled: !!node && step === 3,
    });

    return {
        nodes: nodesQ.data || [],
        isLoadingNodes: nodesQ.isLoading,
        templates: templatesQ.data || [],
        isLoadingTemplates: templatesQ.isLoading,
        networks: networksQ.data || [],
        isLoadingNetworks: networksQ.isLoading,
        storage: storageQ.data || [],
        isLoadingStorage: storageQ.isLoading,
    };
}
