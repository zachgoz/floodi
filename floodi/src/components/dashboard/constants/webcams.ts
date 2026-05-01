export interface WebcamConfig {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export const WEBCAMS: WebcamConfig[] = [
  { id: 'SUNNYD_CB_01', name: 'Clam Shell Ln. 1', lat: 34.0517, lng: -77.8855 },
  // Slight offset so the two Clam Shell markers don't perfectly overlap
  { id: 'SUNNYD_CB_01B', name: 'Clam Shell Ln. 2', lat: 34.05185, lng: -77.8855 },
  { id: 'SUNNYD_CB_02', name: 'Starfish Ln.', lat: 34.0490, lng: -77.8869 },
  { id: 'SUNNYD_CB_03', name: 'Oystershell Ln.', lat: 34.0435, lng: -77.8894 },
];
