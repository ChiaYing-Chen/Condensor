export type DefectDepth = '0-20%' | '20-40%' | '40-60%' | '60-80%' | '>80%';
export type DefectType = 'None' | 'Dent' | 'Wear' | 'Pitting' | 'AmmoniaCorrosion';
export type Quadrant = 'IL' | 'IR' | 'OL' | 'OR';
export type TubeStatus = 'Normal' | 'Plugged' | 'Retubed';
export type Material = 'NavalBrass' | 'Brass' | 'Titanium';

export interface InspectionRecord {
  year: number;
  depth: DefectDepth;
  depthValue: number; // Numeric value for calculation (e.g., 10, 30, 50, 70, 90)
  defectType: DefectType;
  status: TubeStatus;
}

export interface TubeData {
  id: string; // e.g., "R10-C25"
  row: number;
  col: number;
  x: number; // Physical x coordinate for rendering
  y: number; // Physical y coordinate for rendering
  quadrant: Quadrant;
  material: Material;
  installDate: string;
  inspections: InspectionRecord[];
}

export interface OverhaulData {
  year: number;
  date: string;
}

export interface UnitData {
  id: string;
  name: string;
  totalTubes: number;
  tubes: TubeData[];
  overhauls: OverhaulData[];
}

export interface MaintenancePolicy {
  pluggingThreshold: number; // e.g., 60 for >60%
  thinningRateThreshold: number; // e.g., 15 for >15% per year
}
