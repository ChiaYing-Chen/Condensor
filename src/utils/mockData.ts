import { TubeData, UnitData, Quadrant, Material, DefectDepth, DefectType, TubeStatus, InspectionRecord } from '../types';

const generateTubes = (radius: number, spacing: number, seedOffset: number): TubeData[] => {
  const tubes: TubeData[] = [];
  const overhauls = [2014, 2016, 2018, 2020, 2022, 2024];
  
  for (let row = -radius; row <= radius; row += spacing) {
    for (let col = -radius; col <= radius; col += spacing) {
      if (row * row + col * col <= radius * radius) {
        if (Math.abs(row) < spacing * 2 || Math.abs(col) < spacing * 2) continue;

        let quadrant: Quadrant = 'IL';
        if (row < 0 && col < 0) quadrant = 'IL';
        if (row < 0 && col > 0) quadrant = 'IR';
        if (row > 0 && col < 0) quadrant = 'OL';
        if (row > 0 && col > 0) quadrant = 'OR';

        const id = `R${row}-C${col}`;
        
        const inspections: InspectionRecord[] = [];
        let currentDepthValue = (Math.random() * 5) + seedOffset; 
        let currentStatus: TubeStatus = 'Normal';
        
        const isHighWearArea = row < -radius * 0.7 && Math.abs(col) < radius * 0.5;
        const baseDegradationRate = isHighWearArea ? 8 : 3;

        for (const year of overhauls) {
          if (currentStatus === 'Plugged' || currentStatus === 'Retubed') {
            inspections.push({ year, depth: '>80%', depthValue: 100, defectType: 'None', status: currentStatus });
            continue;
          }

          currentDepthValue += Math.random() * baseDegradationRate;
          
          let depth: DefectDepth = '0-20%';
          if (currentDepthValue > 80) depth = '>80%';
          else if (currentDepthValue > 60) depth = '60-80%';
          else if (currentDepthValue > 40) depth = '40-60%';
          else if (currentDepthValue > 20) depth = '20-40%';

          let defectType: DefectType = 'None';
          if (currentDepthValue > 20) {
            const types: DefectType[] = ['Dent', 'Wear', 'Pitting', 'AmmoniaCorrosion'];
            defectType = types[Math.floor(Math.random() * types.length)];
          }

          if (currentDepthValue >= 80) currentStatus = 'Plugged';

          inspections.push({
            year, depth, depthValue: Math.min(currentDepthValue, 100), defectType, status: currentStatus
          });
        }

        tubes.push({
          id, row, col, x: col, y: row, quadrant, material: 'NavalBrass', installDate: '2010-01-01', inspections
        });
      }
    }
  }
  return tubes;
};

export const mockUnits: UnitData[] = [1, 2, 3, 4].map(num => {
  const generatedTubes = generateTubes(100, 4, num * 1.5);
  return {
    id: `U${num}`,
    name: `Unit ${num}`,
    totalTubes: generatedTubes.length,
    overhauls: [
      { year: 2014, date: '2014-10-15' },
      { year: 2016, date: '2016-11-02' },
      { year: 2018, date: '2018-09-20' },
      { year: 2020, date: '2020-10-05' },
      { year: 2022, date: '2022-11-12' },
      { year: 2024, date: '2024-10-28' },
    ],
    tubes: generatedTubes
  };
});
