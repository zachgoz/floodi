/** Select source by metadata, never by record count (NOAA is embedded too). */
export interface SensorParameter {
  id: string;
  units: string;
  www?: {
    description?: string;
    uom_ts_suffix?: string;
    use_timestamp?: boolean;
    stacked_master?: string | null;
  };
  observations?: {
    times: string[];
    values: string[];
    quality_levels?: string[];
  };
}
export function selectLocalSensor(parameters: SensorParameter[]) {
  return (
    parameters.find(
      (p) =>
        /^(water_level|Water level|Hohonu \(observed\))$/i.test(p.id) &&
        p.www?.use_timestamp === true &&
        !p.www.stacked_master &&
        p.observations?.times.length,
    ) ||
    parameters.find(
      (p) =>
        /^(water_level_raw|Water level \(raw\))$/i.test(p.id) &&
        p.www?.use_timestamp === true &&
        p.observations?.times.length,
    )
  );
}
export function localSensorLevels(
  parameters: SensorParameter[],
  navd88ToMllwFt: number,
  preferRaw = false,
) {
  const p = preferRaw
    ? parameters.find(
        (p) =>
          /^(water_level_raw|Water level \(raw\))$/i.test(p.id) &&
          p.www?.use_timestamp === true &&
          p.observations?.times.length,
      )
    : selectLocalSensor(parameters);
  const levels: Record<string, number> = {};
  // Fail closed on unknown units/datum. Raw/QC measurements are not certified storm surge.
  if (
    !p?.observations ||
    !["m", "ft"].includes(p.units) ||
    !/NAVD88/i.test(p.www?.uom_ts_suffix || "")
  )
    return levels;
  p.observations.times.forEach((t, i) => {
    const q = p.observations?.quality_levels?.[i];
    const value = p.observations!.values[i];
    if (value === null || value === undefined || String(value).trim() === "")
      return;
    const raw = Number(value);
    const ms = Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(t) ? t : t + "Z");
    if (
      !Number.isFinite(raw) ||
      !Number.isFinite(ms) ||
      q === "1" ||
      q === "2" ||
      q === "-9"
    )
      return;
    levels[new Date(ms).toISOString()] =
      raw * (p.units === "m" ? 1 / 0.3048 : 1) + navd88ToMllwFt;
  });
  return levels;
}

/** Preserve the established regional FIMAN gauge, distinct from the local raw sensor. */
export function regionalGaugeLevels(parameters: SensorParameter[], navd88ToMllwFt: number) {
  const parameter = parameters.find(p => (/^FIMAN \(observed\)$/i.test(p.id) || p.id === 'water_level') && /fiman\.nc\.gov\/.+id=30046\b/i.test(p.www?.description || ''));
  if (!parameter) return {};
  // Reuse strict unit/datum/QC parsing without conflating source-selection metadata.
  return localSensorLevels([{ ...parameter, id:'Water level', www:{ ...parameter.www, use_timestamp:true, stacked_master:null } }], navd88ToMllwFt);
}
