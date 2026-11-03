'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const admin = require('firebase-admin');

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.GCLOUD_PROJECT !== 'demo-voting-load') {
  throw new Error('Refusing to run outside the dedicated Firestore emulator.');
}
admin.initializeApp({ projectId: 'demo-voting-load' });
const db = admin.firestore();
const collection = db.collection('votes_2026_2027');
const sizes = [10, 50, 100];
const percentile = (values, p) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];

async function runBatch(count) {
  const runId = `load${count}_${Date.now()}`;
  const started = performance.now();
  const results = await Promise.allSettled(Array.from({ length: count }, async (_, i) => {
    const uid = `${runId}_user${i}`;
    const doc = collection.doc(`Seminar_1_${uid}`);
    const t = performance.now();
    await doc.create({
      participant: `${uid}@natur.cuni.cz`, uid, seminar: 'Seminar 1',
      presentations: [
        { name: 'Botond Bolgár', score: 8, comment: '' },
        { name: 'Tereza Kárníková', score: 9, comment: '' },
        { name: 'Deepak Kumar Bhuyan', score: 7, comment: '' },
        { name: 'Aparna Vijayalekshmi Muraleedharan', score: 10, comment: '' }
      ],
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    return { uid, ms: performance.now() - t };
  }));
  const failures = results.filter(r => r.status === 'rejected');
  const successful = results.filter(r => r.status === 'fulfilled');
  const timings = successful.map(r => r.value.ms).sort((a, b) => a - b);
  const docs = await Promise.all(Array.from({ length: count }, (_, i) =>
    collection.doc(`Seminar_1_${runId}_user${i}`).get()));
  const stored = docs.filter(d => d.exists).length;
  assert.equal(failures.length, 0, `Failed writes: ${failures.map(r => String(r.reason)).join('; ')}`);
  assert.equal(stored, count, 'Some votes are missing');
  const first = collection.doc(`Seminar_1_${runId}_user0`);
  await assert.rejects(first.create({ uid: 'duplicate' }), e => e.code === 6 || e.code === 'already-exists', 'Duplicate creation must fail');
  const firstAfter = await first.get();
  assert.equal(firstAfter.data().uid, `${runId}_user0`, 'Original vote was overwritten');
  console.log(JSON.stringify({ concurrent: count, successful: successful.length, stored,
    duplicatesBlocked: true, totalMs: Math.round(performance.now() - started),
    medianWriteMs: Math.round(percentile(timings, 0.5)), p95WriteMs: Math.round(percentile(timings, 0.95)) }));
}
(async () => { for (const size of sizes) await runBatch(size); console.log('PASS: emulator write-concurrency tests'); })()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await admin.app().delete(); });
