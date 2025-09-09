import React, { useState } from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonSearchbar,
  IonSpinner,
  IonNote,
  IonButton,
  IonButtons,
  IonPopover,
  IonContent,
  IonListHeader,
  IonIcon,
} from '@ionic/react';
import { navigateOutline, refresh } from 'ionicons/icons';
import { useStationSearch } from './hooks/useStationSearch';
import type { Station } from './types';

/**
 * Props for the StationSelector component
 */
interface StationSelectorProps {
  /** Currently selected station ID */
  selectedStationId: string;
  /** Callback when station selection changes */
  onStationChange: (station: Station) => void;
  /** Optional error message to display */
  error?: string | null;
  /** Optional success message to display */
  successMessage?: string | null;
}

/**
 * Professional station selector component with search functionality
 * 
 * Replaces the custom portal-based dropdown with proper Ionic components.
 * Features debounced search, keyboard navigation, and professional styling.
 * 
 * @param props StationSelectorProps
 * @returns JSX.Element
 */
export const StationSelector: React.FC<StationSelectorProps> = ({
  selectedStationId,
  onStationChange,
  error,
  successMessage,
}) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  // Note: searchbar ref removed as it wasn't used

  const {
    searchResults,
    loading,
    error: searchError,
    searchQuery,
    selectedStation,
    setSearchQuery,
    navigateSelection,
    // setSelectedIndex,
    getStationDisplayName,
    loadStations,
  } = useStationSearch(selectedStationId);

  /**
   * Handle station selection
   */
  const handleStationSelect = (station: Station) => {
    onStationChange(station);
    setPopoverOpen(false);
    setSearchQuery(''); // Clear search after selection
  };

  /**
   * Handle search input changes
   */
  const handleSearchChange = (event: CustomEvent<{ value?: string }>) => {
    const query = event.detail.value || '';
    setSearchQuery(query);
  };

  /**
   * Handle keyboard navigation in search results
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        navigateSelection('down');
        break;
      case 'ArrowUp':
        event.preventDefault();
        navigateSelection('up');
        break;
      case 'Enter':
        event.preventDefault();
        if (selectedStation) {
          handleStationSelect(selectedStation);
        }
        break;
      case 'Escape':
        setPopoverOpen(false);
        break;
    }
  };

  /**
   * Open popover and ensure stations are loaded
   */
  const handlePopoverOpen = () => {
    setPopoverOpen(true);
    loadStations();
  };

  /**
   * Reset to default station
   */
  const handleReset = () => {
    const defaultStation: Station = {
      id: '8658163',
      name: 'Wrightsville Beach',
      state: 'NC',
    };
    onStationChange(defaultStation);
  };

  const displayName = getStationDisplayName(selectedStationId) || selectedStationId;
  const isDefault = selectedStationId === '8658163';

  return (
    <IonList className="station-selector">
      <IonListHeader>
        <IonIcon icon={navigateOutline} slot="start" />
        <IonLabel>Station</IonLabel>
      </IonListHeader>
      
      <IonItem lines="none">
        <IonNote color="medium">
          NOAA station ID to use for observations and predictions.
        </IonNote>
      </IonItem>

      <IonItem>
        <IonLabel position="stacked">Station</IonLabel>
        <div className="station-selector-field">
          <IonButton
            id="station-trigger"
            fill="outline"
            className="station-display-button"
            onClick={handlePopoverOpen}
          >
            <IonLabel>{displayName}</IonLabel>
          </IonButton>
          
          <IonButtons>
            <IonButton
              onClick={handleReset}
              color="medium"
              fill="clear"
              disabled={isDefault}
              title="Reset to default station"
            >
              Reset
            </IonButton>
          </IonButtons>
        </div>
      </IonItem>

      {error && (
        <IonItem lines="none">
          <IonNote color="danger">{error}</IonNote>
        </IonItem>
      )}

      {successMessage && (
        <IonItem lines="none">
          <IonNote color="success">{successMessage}</IonNote>
        </IonItem>
      )}

      {/* Professional popover with search functionality */}
      <IonPopover
        trigger="station-trigger"
        isOpen={popoverOpen}
        onDidDismiss={() => setPopoverOpen(false)}
        showBackdrop={true}
        side="bottom"
        alignment="start"
        className="station-selector-popover"
      >
        <IonContent>
          <div className="station-search-container" onKeyDown={handleKeyDown}>
            <IonSearchbar
              placeholder="Search stations by ID, name, or state..."
              value={searchQuery}
              onIonInput={handleSearchChange}
              showClearButton="focus"
              debounce={300}
              className="station-searchbar"
            />

            {loading && (
              <div className="station-loading">
                <IonSpinner name="crescent" />
                <IonNote>Loading stations...</IonNote>
              </div>
            )}

            {searchError && (
              <IonItem>
                <IonNote color="danger">{searchError}</IonNote>
                <IonButton
                  slot="end"
                  fill="clear"
                  onClick={loadStations}
                  title="Retry loading stations"
                >
                  <IonIcon icon={refresh} />
                </IonButton>
              </IonItem>
            )}

            {!loading && !searchError && (
              <IonList>
                {searchResults.length === 0 ? (
                  <IonItem>
                    <IonNote color="medium">No matching stations found</IonNote>
                  </IonItem>
                ) : (
                  searchResults.map((station) => (
                    <IonItem
                      key={station.id}
                      button
                      onClick={() => handleStationSelect(station)}
                      className={selectedStation?.id === station.id ? 'selected-station' : ''}
                    >
                      <IonLabel>
                        <h3>{station.name}</h3>
                        <p>
                          ID: {station.id}
                          {station.state && ` • ${station.state}`}
                          {station.lat && station.lon && (
                            <span className="station-coordinates">
                              {` • ${station.lat.toFixed(4)}, ${station.lon.toFixed(4)}`}
                            </span>
                          )}
                        </p>
                      </IonLabel>
                    </IonItem>
                  ))
                )}
              </IonList>
            )}
          </div>
        </IonContent>
      </IonPopover>
    </IonList>
  );
};

export default StationSelector;
