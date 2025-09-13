import React from 'react';
import {
  IonButtons,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonTitle,
  IonToolbar,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/react';
import { chatbubblesOutline, refreshOutline, settingsOutline } from 'ionicons/icons';
import { CommentManager } from 'src/components/comments/CommentManager';
import { useSettingsStorage } from 'src/components/Tab2/hooks/useSettingsStorage';
import { useCommentsTab } from 'src/hooks/useCommentsTab';
import { useHistory } from 'react-router-dom';
import 'src/pages/Tab4.css';

/**
 * Comments Tab (Tab4)
 *
 * Dedicated, full-screen interface for browsing and managing comments across stations.
 * Integrates the enhanced CommentManager in standalone mode with advanced filters and
 * station selection. Pull-to-refresh is provided for manual updates.
 */
const Tab4: React.FC = () => {
  const history = useHistory();
  const { config } = useSettingsStorage();
  const {
    stationId,
    refresh,
    loading,
    filterState,
    setFilterState,
    stats,
  } = useCommentsTab(config.station.id);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Comments</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => refresh?.()} aria-label="Refresh comments">
              <IonIcon icon={refreshOutline} />
            </IonButton>
            <IonButton onClick={() => history.push('/profile')} aria-label="Comments settings">
              <IonIcon icon={settingsOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar className="tab4-toolbar-secondary">
          <div className="tab4-stats-only">
            <div className="tab4-stats" aria-live="polite">
              <div className="tab4-stat" title="Total comments">
                <IonIcon icon={chatbubblesOutline} aria-hidden="true" />
                <span className="tab4-stat-count">{stats.total}</span>
              </div>
              <div className="tab4-stat sep" aria-hidden="true" />
              <div className="tab4-stat" title="Last 24h">
                <span className="tab4-stat-label">24h</span>
                <span className="tab4-stat-count">{stats.last24h}</span>
              </div>
            </div>
          </div>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <IonRefresher
          slot="fixed"
          disabled={loading}
          onIonRefresh={async (ev) => {
            try {
              await refresh?.();
            } finally {
              ev.detail.complete();
            }
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <CommentManager
          standalone
          stationId={stationId}
          searchQuery={filterState.search}
          onSearchChange={(q) => setFilterState((s) => ({ ...s, search: q }))}
          authorFilter={filterState.author}
          onAuthorFilterChange={(a) => setFilterState((s) => ({ ...s, author: a }))}
          dateRange={filterState.range}
          onDateRangeChange={(r) => setFilterState((s) => ({ ...s, range: r }))}
          dataContext={filterState.dataContext}
          onDataContextChange={(d) => setFilterState((s) => ({ ...s, dataContext: d }))}
          useFilterModal
          renderHeader={true}
        />
      </IonContent>
    </IonPage>
  );
};

export default Tab4;

