// -----------------------------------------------------------------------------
// Answers of the local API v3 of a Genius Hub, shaped after what
// geniushub-client reads (tests/data_properties_v3_conversion, MIT) and the
// public documentation. Not recorded from a real hub.
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.50';
export const LOGIN = { username: 'hubuser', password: 'hubpass' };
export const CONFIG = { address: ADDRESS, ...LOGIN };
export const UID = 'ab:cd:ef:01:02:03';
/** 2026-10-25T10:00:00Z, the virtual clock of the tests. */
export const NOW = Date.parse('2026-10-25T10:00:00Z');
export const NOW_SECONDS = Math.floor(NOW / 1000);

export const ZONE = { MANAGER: 0, LOUNGE: 1, KITCHEN: 2, FLOOR: 3, WATER: 4, TOWEL: 5 };

const timer = (sp) => [{ fSP: sp, iDay: 0, iTm: -1 }];
const footprint = () => ({
  bIsNight: 0,
  fFootprintAwaySP: 14,
  iFootprintTmNightStart: 75600,
  iProfile: 2,
  lstSP: [{ fSP: 16, iDay: 0, iTm: 0 }],
  objReactive: { fActivityLevel: 0 },
});

export function zone(overrides = {}) {
  return {
    iID: 1,
    strName: 'Lounge',
    iType: 3,
    iMode: 2,
    fPV: 20.5,
    fSP: 21,
    fBoostSP: 0,
    iBoostTimeRemaining: 0,
    iFlagExpectedKit: 7,
    bIsActive: 1,
    bInHeatEnabled: 1,
    bOutRequestHeat: 1,
    lstIssues: [],
    objTimer: timer(21),
    objFootprint: footprint(),
    zoneReactive: { fActivityLevel: 0 },
    trigger: { reactive: 0, output: 0 },
    zoneSubType: 1,
    strBuildDate: 'Jan 16 2020',
    ...overrides,
  };
}

/** The zones of a small house: the manager, a lounge with a PIR, a kitchen, an underfloor, the hot water, a towel rail on a timer. */
export function zones() {
  return [
    zone({ iID: ZONE.MANAGER, strName: 'My House', iType: 1, iMode: 2, fPV: 19.8, lOptions: 0 }),
    zone({
      iID: ZONE.LOUNGE,
      strName: 'Lounge',
      iFlagExpectedKit: 7,
      zoneReactive: { fActivityLevel: 1.5 },
    }),
    zone({
      iID: ZONE.KITCHEN,
      strName: 'Kitchen',
      iFlagExpectedKit: 3,
      iMode: 1,
      fPV: 18,
      fSP: 4,
      bOutRequestHeat: 0,
      lstIssues: [{ id: 'zone:using_weather_temp', level: 1 }],
    }),
    zone({ iID: ZONE.FLOOR, strName: 'Hall floor', iType: 5, zoneSubType: 0, fPV: 22.2, fSP: 22 }),
    zone({
      iID: ZONE.WATER,
      strName: 'Hot water',
      iType: 5,
      zoneSubType: 1,
      iMode: 16,
      fPV: 48,
      fSP: 55,
      fBoostSP: 55,
      iBoostTimeRemaining: 1800,
      bOutRequestHeat: 1,
    }),
    zone({
      iID: ZONE.TOWEL,
      strName: 'Towel rail',
      iType: 2,
      iMode: 2,
      fPV: 0,
      fSP: 1,
      bOutRequestHeat: 1,
    }),
  ];
}

export const zonesPage = (list = zones()) => ({ data: list });

const value = (val) => ({ val });

export function node(addr, hash, location, channels = {}, extra = {}) {
  const childValues = {
    hash: value(hash),
    location: value(location),
    lastComms: value(NOW_SECONDS - 60),
  };
  for (const [id, val] of Object.entries(channels)) {
    childValues[id] = value(val);
  }
  return {
    addr,
    childValues: { ...childValues, ...extra.childValues },
    childNodes: {
      _cfg: { addr: '_cfg', childValues: { sku: value('X'), max_sp: value(28), min_sp: value(4) } },
      ...extra.childNodes,
    },
  };
}

/** The devices: a radiator valve, a room thermostat, a plug with a channel, a motion sensor. */
export function devices() {
  return {
    2: node('2', '0x0000000200040005', 'Lounge', {
      Battery: 85,
      TEMPERATURE: 20.5,
      HEATING_1: 21,
    }),
    3: node('3', '0x0000005900050001', 'Kitchen', { Battery: 60, TEMPERATURE: 18 }),
    4: node(
      '4',
      '0x0000013C00110001',
      'Towel rail',
      { SwitchBinary: 1 },
      {
        childNodes: {
          1: { addr: '1', childValues: { SwitchBinary: value(1) }, childNodes: {} },
        },
      },
    ),
    5: node('5', '0x0000013C00500002', 'Lounge', { Battery: 100, LUMINANCE: 120, Motion: 1 }),
  };
}

export const dataManagerPage = (nodes = devices()) => ({
  data: {
    childNodes: {
      1: {
        addr: '1',
        childNodes: {
          1: { addr: '1', childValues: { hash: value('HUB') }, childNodes: {} },
          ...nodes,
        },
      },
      WeatherData: { addr: 'WeatherData', childNodes: { x: node('9', 'VIRTUAL', '') } },
    },
  },
});

export const releasePage = (uid = UID) => ({ data: { release: '5.3.6', UID: uid } });

export const patchOk = () => ({ error: 0, data: {} });

export const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', date: new Date(NOW).toUTCString() },
    ...init,
  });
