import type { LocationConfig } from '../components/Tab2/types';

export const LOCATIONS: Record<string, LocationConfig> = {
  'carolina-beach': {
    id: 'carolina-beach',
    name: 'Carolina Beach',
    state: 'NC',
    noaaStationId: '8658163',
    webcamIds: ['SUNNYD_CB_01', 'SUNNYD_CB_01B', 'SUNNYD_CB_02', 'SUNNYD_CB_03'],
    thresholds: {
      minor: 5.6,
      moderate: 7.0,
      major: 7.7,
      extreme: 8.5,
    },
    coords: { lat: 34.0352, lon: -77.8931 },
    navd88ToMllwOffset: 2.75,
  }
};

export const DEFAULT_LOCATION_ID = 'carolina-beach';
