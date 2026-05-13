import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { persistImage } from './utils/storage';
import { ObservationBucket } from './types/data';

const db = admin.firestore();

/**
 * Periodically scans recent observations to ensure all high-value imagery 
 * (flood events or top-of-hour) is persisted to Firebase Storage.
 * This acts as a more robust fallback for syncWaterLevels' inline persistence.
 */
export const syncImagery = onSchedule({
  schedule: 'every 30 minutes',
  memory: '512MiB',
  timeoutSeconds: 540
}, async (event) => {
  const now = new Date();
  const currentMonth = now.toISOString().substring(0, 7);
  
  // For simplicity, we just check the current month for all locations
  const locationsSnap = await db.collection('locations').get();
  
  for (const locDoc of locationsSnap.docs) {
    const locId = locDoc.id;
    const obsRef = db.doc(`locations/${locId}/observations/${currentMonth}`);
    const obsSnap = await obsRef.get();
    
    if (!obsSnap.exists) continue;
    
    const data = obsSnap.data() as ObservationBucket;
    if (!data.imagery) continue;
    
    let updated = false;
    const imagery = { ...data.imagery };
    
    for (const [t, cams] of Object.entries(imagery)) {
      const date = new Date(t);
      const isTopOfHour = date.getUTCMinutes() < 10;
      const fimanLevel = data.fiman?.[t] || 0;
      
      // Thresholds might be in the location doc
      const locData = locDoc.data();
      const minorThreshold = locData.thresholds?.minor || 5.6;
      const isFlood = fimanLevel >= minorThreshold;

      if (isFlood || isTopOfHour) {
        for (const [camId, url] of Object.entries(cams)) {
          // If it's already persisted (storage://), skip
          if (url.startsWith('storage://')) continue;
          
          try {
            console.log(`Persisting imagery for ${locId} cam ${camId} at ${t}...`);
            const dest = `imagery/${locId}/${camId}/${t.replace(/[:.-]/g, '')}.jpg`;
            await persistImage(url, dest);
            imagery[t][camId] = `storage://${dest}`;
            updated = true;
          } catch (err) {
            console.error(`Failed to persist imagery for ${locId} ${camId} at ${t}:`, err);
          }
        }
      }
    }
    
    if (updated) {
      await obsRef.update({ imagery });
      console.log(`Updated imagery for ${locId} in month ${currentMonth}`);
    }
  }
});
