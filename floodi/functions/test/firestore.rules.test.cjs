const { after, before, beforeEach, describe, it } = require('node:test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, Timestamp } = require('firebase/firestore');

describe('Firestore account roles and forecast boundaries', {
  skip: process.env.FIRESTORE_EMULATOR_HOST ? false : 'Run npm run test:rules with the isolated Firestore emulator',
}, () => {
  let environment;
  const profile = (uid, role = 'user') => ({
    uid,
    role,
    isActive: true,
    email: null,
    displayName: 'Resident',
    photoURL: null,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  });
  const client = (uid, provider = 'password') => environment.authenticatedContext(uid, {
    firebase: { sign_in_provider: provider },
  }).firestore();
  const seed = async (uid, role) => environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}`), profile(uid, role));
  });

  before(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-floodcast-rules',
      firestore: {
        host,
        port: Number(port),
        rules: await readFile(path.join(__dirname, '../../firestore.rules'), 'utf8'),
      },
    });
  });
  beforeEach(async () => environment.clearFirestore());
  after(async () => environment?.cleanup());

  it('permits owner creation of normal and anonymous profiles', async () => {
    await assertSucceeds(setDoc(doc(client('registered'), 'users/registered'), profile('registered')));
    await assertSucceeds(setDoc(doc(client('guest', 'anonymous'), 'users/guest'), profile('guest', 'anonymous')));
  });

  it('rejects self-created admin and moderator profiles', async () => {
    for (const role of ['admin', 'moderator']) {
      await assertFails(setDoc(doc(client(role), `users/${role}`), profile(role, role)));
    }
  });

  it('rejects unauthenticated and other-user profile creation', async () => {
    await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), 'users/guest'), profile('guest')));
    await assertFails(setDoc(doc(client('alice'), 'users/bob'), profile('bob')));
  });

  it('preserves ordinary owner profile edits and denies editing another user', async () => {
    await seed('alice', 'user');
    await seed('bob', 'user');
    await assertSucceeds(updateDoc(doc(client('alice'), 'users/alice'), { displayName: 'Alice' }));
    await assertFails(updateDoc(doc(client('alice'), 'users/bob'), { displayName: 'Spoofed' }));
  });

  it('rejects privileged role escalation through both updates and replacement writes', async () => {
    await seed('alice', 'user');
    const reference = doc(client('alice'), 'users/alice');
    await assertFails(updateDoc(reference, { role: 'admin' }));
    await assertFails(setDoc(reference, profile('alice', 'moderator')));
  });

  it('allows anonymous registration only after authentication is linked to a non-anonymous provider', async () => {
    await seed('linked', 'anonymous');
    await seed('unlinked', 'anonymous');
    await assertSucceeds(updateDoc(doc(client('linked'), 'users/linked'), { role: 'user' }));
    await assertFails(updateDoc(doc(client('unlinked', 'anonymous'), 'users/unlinked'), { role: 'user' }));
  });

  it('rejects all other owner role changes including anonymous-to-admin', async () => {
    await seed('guest', 'anonymous');
    await seed('alice', 'user');
    await assertFails(updateDoc(doc(client('guest'), 'users/guest'), { role: 'admin' }));
    await assertFails(updateDoc(doc(client('alice'), 'users/alice'), { role: 'anonymous' }));
  });

  it('preserves trusted administrator promotion and moderation permissions', async () => {
    await seed('trusted', 'admin');
    await seed('alice', 'user');
    await assertSucceeds(updateDoc(doc(client('trusted'), 'users/alice'), { role: 'moderator' }));
    await assertSucceeds(updateDoc(doc(client('trusted'), 'users/alice'), { role: 'admin' }));
    await assertSucceeds(getDoc(doc(client('trusted'), 'users/alice')));
  });

  it('denies moderator role management and ordinary owner deletion', async () => {
    await seed('moderator', 'moderator');
    await seed('alice', 'user');
    await assertFails(updateDoc(doc(client('moderator'), 'users/alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(client('moderator'), 'users/moderator'), { role: 'admin' }));
    await assertFails(deleteDoc(doc(client('alice'), 'users/alice')));
  });

  it('keeps public forecast reads available while denying every client forecast write', async () => {
    await seed('trusted', 'admin');
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'locations/carolina-beach/outlook/current'), { status: 'available' });
    });
    await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), 'locations/carolina-beach/outlook/current')));
    for (const uid of ['resident', 'trusted']) {
      await assertFails(setDoc(doc(client(uid), 'locations/carolina-beach/outlook/current'), { status: 'forged' }));
    }
  });

  it('keeps daily and legacy observations public and denies all client writes', async () => {
    await seed('trusted', 'admin');
    const paths = ['locations/carolina-beach/observations/2026-10', 'locations/carolina-beach/observations/2026-10-14'];
    await environment.withSecurityRulesDisabled(async context => {
      for (const path of paths) await setDoc(doc(context.firestore(), path), { fiman: { '2026-10-14T12:00:00Z': 4.3 } });
    });
    for (const path of paths) {
      await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), path)));
      for (const uid of ['resident', 'trusted']) {
        await assertFails(setDoc(doc(client(uid), path), { fiman: { forged: 99 } }));
        await assertFails(deleteDoc(doc(client(uid), path)));
      }
    }
  });

  it('keeps forecast models and private input archives inaccessible to clients', async () => {
    await seed('trusted', 'admin');
    for (const uid of ['resident', 'trusted']) {
      for (const location of ['forecast_models/carolina-beach', 'forecast_input_archive/carolina-beach/issues/issue']) {
        await assertFails(getDoc(doc(client(uid), location)));
        await assertFails(setDoc(doc(client(uid), location), { forged: true }));
      }
    }
  });
});
