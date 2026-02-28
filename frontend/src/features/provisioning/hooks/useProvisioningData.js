import { useQuery } from '@tanstack/react-query';
import { getNodes, getTemplates, getNetworks, getStorage } from '../../../api/proxmox';

export function useProvisioningData(node, step) {
    const nodesQ = useQuery({
        queryKey: ['nodes'],
        queryFn: getNodes
    });
    const nodes = nodesQ.data || [];
    const effectiveNode = node || nodes[0]?.node;

    const templatesQ = useQuery({
        queryKey: ['templates', effectiveNode],
        queryFn: () => getTemplates(effectiveNode),
        enabled: !!effectiveNode && step === 1,
    });

    const networksQ = useQuery({
        queryKey: ['networks', effectiveNode],
        queryFn: () => getNetworks(effectiveNode),
        enabled: !!effectiveNode && step === 4, // Step 4 is Network Config
    });

    const storageQ = useQuery({
        queryKey: ['storage', effectiveNode],
        queryFn: () => getStorage(effectiveNode),
        enabled: !!effectiveNode && step === 4,
    });

    return {
        nodes,
        isLoadingNodes: nodesQ.isLoading,
        templates: templatesQ.data || [],
        isLoadingTemplates: templatesQ.isLoading,
        networks: networksQ.data || [],
        isLoadingNetworks: networksQ.isLoading,
        storage: storageQ.data || [],
        isLoadingStorage: storageQ.isLoading,
    };
}
