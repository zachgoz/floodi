import React from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonDatetime,
  IonChip,
  IonText,
  IonIcon,
} from '@ionic/react';
import { closeOutline } from 'ionicons/icons';

export interface FilterModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  authorFilter: string;
  onAuthorFilterChange: (value: string) => void;
  dateRange: { start: string; end: string } | null;
  onDateRangeChange: (range: { start: string; end: string } | null) => void;
  dataContext: { observed?: boolean; predicted?: boolean; adjusted?: boolean } | null;
  onDataContextChange: (context: { observed?: boolean; predicted?: boolean; adjusted?: boolean } | null) => void;
}

/**
 * FilterModal
 *
 * Modal component for advanced comment filtering with search, author, date range, and data context filters.
 */
export const FilterModal: React.FC<FilterModalProps> = ({
  isOpen,
  onDismiss,
  searchQuery,
  onSearchChange,
  authorFilter,
  onAuthorFilterChange,
  dateRange,
  onDateRangeChange,
  dataContext,
  onDataContextChange,
}) => {
  const handleDateChange = (field: 'start' | 'end', value: string | undefined) => {
    if (!value && !dateRange?.[field === 'start' ? 'end' : 'start']) {
      onDateRangeChange(null);
      return;
    }
    const newRange = {
      start: field === 'start' ? (value || new Date().toISOString()) : (dateRange?.start || new Date().toISOString()),
      end: field === 'end' ? (value || new Date().toISOString()) : (dateRange?.end || new Date().toISOString()),
    };
    onDateRangeChange(newRange);
  };

  const clearAllFilters = () => {
    onSearchChange('');
    onAuthorFilterChange('');
    onDateRangeChange(null);
    onDataContextChange(null);
  };

  const hasActiveFilters = searchQuery || authorFilter || dateRange || dataContext;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss} className="filter-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Filter Comments</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Search */}
        <IonItem>
          <IonLabel position="stacked">Search</IonLabel>
          <IonInput
            value={searchQuery}
            onIonInput={(e) => onSearchChange((e.detail.value as string) ?? '')}
            placeholder="Search content, author, or station"
            clearInput
          />
        </IonItem>

        {/* Author */}
        <IonItem>
          <IonLabel position="stacked">Author</IonLabel>
          <IonInput
            value={authorFilter}
            onIonInput={(e) => onAuthorFilterChange((e.detail.value as string) ?? '')}
            placeholder="Filter by author name"
            clearInput
          />
        </IonItem>

        {/* Date Range */}
        <IonItem>
          <IonLabel position="stacked">Start Date</IonLabel>
          <IonDatetime
            presentation="date-time"
            value={dateRange?.start}
            onIonChange={(e) => handleDateChange('start', e.detail.value as string)}
          />
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">End Date</IonLabel>
          <IonDatetime
            presentation="date-time"
            value={dateRange?.end}
            onIonChange={(e) => handleDateChange('end', e.detail.value as string)}
          />
        </IonItem>

        {/* Data Context */}
        <IonItem>
          <IonLabel position="stacked">Data Context</IonLabel>
          <div className="filter-data-context-chips">
            <IonChip
              outline={!dataContext?.observed}
              onClick={() => onDataContextChange({ ...dataContext, observed: !dataContext?.observed })}
            >
              <IonLabel>Observed</IonLabel>
            </IonChip>
            <IonChip
              outline={!dataContext?.predicted}
              onClick={() => onDataContextChange({ ...dataContext, predicted: !dataContext?.predicted })}
            >
              <IonLabel>Predicted</IonLabel>
            </IonChip>
            <IonChip
              outline={!dataContext?.adjusted}
              onClick={() => onDataContextChange({ ...dataContext, adjusted: !dataContext?.adjusted })}
            >
              <IonLabel>Adjusted</IonLabel>
            </IonChip>
          </div>
        </IonItem>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <IonItem lines="none">
            <IonButton fill="clear" onClick={clearAllFilters} className="clear-filters-button">
              <IonText color="primary">Clear All Filters</IonText>
            </IonButton>
          </IonItem>
        )}
      </IonContent>
    </IonModal>
  );
};

export default FilterModal;