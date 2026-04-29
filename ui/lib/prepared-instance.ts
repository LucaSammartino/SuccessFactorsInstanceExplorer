import type {
    AnyDashboard,
    AnyEdge,
    AnyNode,
    RoleObjPerm,
    RoleSysPerm,
    SearchEntry,
    WorkflowEntry,
} from './types';
import { buildGroupedMap, pushToMapArray } from './utils';
import { buildSearchEntriesFromGraph } from './search';

/** Pure graph + search snapshot for one instance (base in appState, target in compareTargetPrepared). */
export type PreparedInstanceModel = {
    dashboard: AnyDashboard;
    allNodes: AnyNode[];
    allEdges: AnyEdge[];
    nodeById: Map<string, AnyNode>;
    edgesByNode: Map<string, AnyEdge[]>;
    roleObjectPermissions: RoleObjPerm[];
    roleSystemPermissions: RoleSysPerm[];
    roleObjectByRole: Map<string, RoleObjPerm[]>;
    roleObjectByObject: Map<string, RoleObjPerm[]>;
    roleSystemByRole: Map<string, RoleSysPerm[]>;
    workflowEntries: WorkflowEntry[];
    workflowByCode: Map<string, WorkflowEntry>;
    searchEntries: SearchEntry[];
};

export function buildPreparedInstanceModel(data: AnyDashboard): PreparedInstanceModel {
    const allNodes = data.graph.nodes.map((node: AnyNode) => ({ ...node, label: node.label || node.id }));
    const allEdges = data.graph.edges.map((edge: AnyEdge) => ({ ...edge }));
    const nodeById = new Map<string, AnyNode>(allNodes.map((node: AnyNode) => [String(node.id), node]));

    const edgesByNode = new Map<string, AnyEdge[]>();
    for (const edge of allEdges) {
        pushToMapArray(edgesByNode, edge.from, edge);
        pushToMapArray(edgesByNode, edge.to, edge);
    }

    const roleObjectPermissions = (data.permissions.roleObjectPermissions || [])
        .map((entry: RoleObjPerm) => ({
            ...entry,
            roleNode: nodeById.get(entry.roleId),
            objectNode: nodeById.get(entry.objectId),
            moduleFamily: nodeById.get(entry.objectId)?.moduleFamily || 'Unclassified',
            fieldItems: Array.isArray(entry.fieldItems) ? entry.fieldItems : [],
            actionTypesRollup: Array.isArray(entry.actionTypesRollup) ? entry.actionTypesRollup : [],
            fieldItemCount: Number.isFinite(entry.fieldItemCount)
                ? entry.fieldItemCount
                : (Array.isArray(entry.fieldItems) ? entry.fieldItems.length : 0),
            populationAssignments: Array.isArray(entry.populationAssignments) ? entry.populationAssignments : [],
        }))
        .filter((entry: RoleObjPerm) => entry.roleNode && entry.objectNode);

    const roleSystemPermissions = (data.permissions.roleSystemPermissions || [])
        .map((entry: RoleSysPerm) => ({ ...entry, roleNode: nodeById.get(entry.roleId) }))
        .filter((entry: RoleSysPerm) => entry.roleNode);

    const roleObjectByRole = buildGroupedMap(roleObjectPermissions, (entry: RoleObjPerm) => entry.roleId);
    const roleObjectByObject = buildGroupedMap(roleObjectPermissions, (entry: RoleObjPerm) => entry.objectId);
    const roleSystemByRole = buildGroupedMap(roleSystemPermissions, (entry: RoleSysPerm) => entry.roleId);
    const workflowEntries = (data.workflow?.workflows || []).map((entry: WorkflowEntry) => ({ ...entry }));
    const workflowByCode = new Map<string, WorkflowEntry>(workflowEntries.map((entry: WorkflowEntry) => [String(entry.code), entry]));
    const searchEntries = buildSearchEntriesFromGraph(allNodes, roleSystemPermissions, roleObjectPermissions);

    return {
        dashboard: data,
        allNodes,
        allEdges,
        nodeById,
        edgesByNode,
        roleObjectPermissions,
        roleSystemPermissions,
        roleObjectByRole,
        roleObjectByObject,
        roleSystemByRole,
        workflowEntries,
        workflowByCode,
        searchEntries,
    };
}
