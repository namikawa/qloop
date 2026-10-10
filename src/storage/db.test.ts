import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DB_VERSION, openDb } from './db';

describe('openDb', () => {
  it('設計書 5.4 節のストア・キー・索引で作る', async () => {
    const db = await openDb('qloop-schema-test');
    try {
      expect(db.version).toBe(DB_VERSION);
      expect([...db.objectStoreNames].sort()).toEqual([
        'attempts',
        'eventStats',
        'meta',
        'sessions',
      ]);
      const tx = db.transaction(['attempts', 'eventStats', 'sessions', 'meta']);
      const attempts = tx.objectStore('attempts');
      expect(attempts.keyPath).toBe('id');
      expect(attempts.autoIncrement).toBe(true);
      expect([...attempts.indexNames].sort()).toEqual(['byAnsweredAt', 'byEvent', 'bySession']);
      expect(attempts.index('byEvent').keyPath).toBe('eventId');
      expect(attempts.index('byAnsweredAt').keyPath).toBe('answeredAt');
      expect(attempts.index('bySession').keyPath).toBe('sessionId');
      expect(tx.objectStore('eventStats').keyPath).toEqual(['eventId', 'pattern']);
      expect(tx.objectStore('sessions').keyPath).toBe('id');
      expect(tx.objectStore('meta').keyPath).toBe('key');
      await tx.done;
    } finally {
      db.close();
    }
  });
});
