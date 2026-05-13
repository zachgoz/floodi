import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

/**
 * Downloads an image from a URL and uploads it to Firebase Storage.
 * @param url The external URL of the image.
 * @param destination The path in the storage bucket.
 * @returns The public URL or the storage path.
 */
export async function persistImage(url: string, destination: string): Promise<string> {
  const bucket = admin.storage().bucket();
  const file = bucket.file(destination);

  // Check if file already exists to avoid redundant downloads
  const [exists] = await file.exists();
  if (exists) {
    return destination;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${url}: ${response.statusText}`);
  }

  const buffer = await response.buffer();
  await file.save(buffer, {
    metadata: {
      contentType: response.headers.get('content-type') || 'image/jpeg',
    },
  });

  return destination;
}
