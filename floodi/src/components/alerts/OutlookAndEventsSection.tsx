import React from 'react';
import { useHistory } from 'react-router-dom';
import { LOCATIONS } from 'src/constants/locations';
import { useSettingsStorage } from 'src/components/Tab2/hooks/useSettingsStorage';
import { useOperationalForecast } from 'src/components/dashboard/useOperationalForecast';
import NextFloodingEventsCard from 'src/components/dashboard/NextFloodingEventsCard';
import { FloodOutlook } from 'src/components/dashboard/FloodOutlook';
import { hasUpcomingFlooding } from 'src/utils/waterForecast';

export const OutlookAndEventsSection: React.FC = () => {
  const history = useHistory();
  const { config } = useSettingsStorage();
  const {
    loading,
    processedData,
    challenger,
    selectedForecast,
    isTimesFmPrimary,
    operationalForecastPoints,
    operationalSurgePoints,
    operationalUpper,
    operationalForecastDescription,
  } = useOperationalForecast(config);

  const now = processedData?.timeDomain.now || new Date();

  const handleJumpToChartTime = (time: Date) => {
    history.push(`/tab2?t=${encodeURIComponent(time.toISOString())}`);
  };

  if (!processedData && !loading) {
    return null;
  }

  return (
    <div className="alerts-outlook-stack" aria-label="Upcoming flooding events and outlook">
      <NextFloodingEventsCard
        adjustedPoints={operationalForecastPoints}
        predictedPoints={processedData?.predictedPoints || []}
        windPoints={processedData?.windPoints || []}
        precipPoints={processedData?.precipPoints || []}
        floodEvents={processedData?.floodEvents || []}
        thresholds={config.thresholds}
        now={now}
        onTimeChange={handleJumpToChartTime}
        loading={loading}
        streetCalibration={LOCATIONS[config.locationId]?.streetCalibration}
        forecastHorizon={operationalForecastPoints.at(-1)?.t ?? null}
        upperForecastPoints={operationalUpper}
      />
      <FloodOutlook
        selection={
          isTimesFmPrimary
            ? {
                ...selectedForecast,
                totalPoints: operationalForecastPoints,
                residualPoints: operationalSurgePoints,
                horizonEnd: operationalForecastPoints.at(-1)?.t ?? selectedForecast.horizonEnd,
                reason: operationalForecastDescription,
              }
            : selectedForecast
        }
        thresholdFt={config.thresholds.minor}
        thresholds={config.thresholds}
        currentSurgeFt={processedData?.deltaPoints.at(-1)?.v ?? challenger?.currentResidualFt ?? null}
        now={now}
        floodExpected={hasUpcomingFlooding(operationalForecastPoints, config.thresholds.minor, now)}
        floodPossible={hasUpcomingFlooding(operationalUpper, config.thresholds.minor, now)}
        challenger={challenger}
        isTimesFmPrimary={isTimesFmPrimary}
      />
    </div>
  );
};

export default OutlookAndEventsSection;
