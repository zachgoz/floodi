/** Shared operational locations. Subcollections may exist without a Firestore
 * parent document, so scheduled jobs must use this configuration for discovery. */
export const LOCATIONS = [
  {
    id: 'carolina-beach',
    name: 'Carolina Beach',
    noaaStationId: '8658163',
    fimanSensorId: 'SUNNYD_CB_03',
    coords: { lat: 34.0352, lon: -77.8931 },
    thresholds: { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 },
    navd88ToMllwOffset: 2.75
  }
];
