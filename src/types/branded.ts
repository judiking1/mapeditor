// Branded numeric IDs — prevent accidental cross-use of indices.

export type NodeId = number & { readonly __brand: 'NodeId' };
export type SegmentId = number & { readonly __brand: 'SegmentId' };
export type LaneId = number & { readonly __brand: 'LaneId' };
export type VehicleId = number & { readonly __brand: 'VehicleId' };
export type BuildingId = number & { readonly __brand: 'BuildingId' };

export const NODE_NONE = -1 as NodeId;
export const SEG_NONE = -1 as SegmentId;
export const VEH_NONE = -1 as VehicleId;
export const BLDG_NONE = -1 as BuildingId;

export const asNodeId = (n: number): NodeId => n as NodeId;
export const asSegmentId = (n: number): SegmentId => n as SegmentId;
export const asVehicleId = (n: number): VehicleId => n as VehicleId;
export const asBuildingId = (n: number): BuildingId => n as BuildingId;
