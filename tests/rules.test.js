// Basic emulator tests for Firestore rules using @firebase/rules-unit-testing
// Run with: node tests/rules.test.js (after starting emulators) or use a small test runner

const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { setLogLevel } = require('firebase/firestore');
const chai = require('chai');
const expect = chai.expect;

let testEnv;

function authedCtx(uid) {
  return { uid, token: { email: `${uid}@test.local` } };
}

describe('Firestore security rules', function () {
  this.timeout(20000);

  before(async () => {
    setLogLevel('error');
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-rtc',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('member can read/write messages; non-member cannot', async () => {
    const roomId = 'r1';
    const admin = authedCtx('admin');
    const member = authedCtx('u1');
    const nonMember = authedCtx('u2');

    // Seed room as admin/creator
    const adminDb = testEnv.authenticatedContext(admin.uid).firestore();
    await adminDb.collection('chatrooms').doc(roomId).set({ title: 'Room', createdBy: admin.uid });
    // Creator bootstraps their own admin membership (allowed by rules)
    await assertSucceeds(adminDb.collection('chatrooms').doc(roomId).collection('members').doc(admin.uid).set({ role: 'admin' }));
    // Admin adds a regular member
    await assertSucceeds(adminDb.collection('chatrooms').doc(roomId).collection('members').doc('u1').set({ role: 'member' }));

    const memberDb = testEnv.authenticatedContext(member.uid).firestore();
    const nonMemberDb = testEnv.authenticatedContext(nonMember.uid).firestore();

    const msgRef = memberDb.collection('chatrooms').doc(roomId).collection('messages');

    await assertSucceeds(msgRef.add({ senderId: 'u1', text: 'hi', imageUrl: '', timestamp: new Date(), deliveredTo: ['u1'], seenBy: [] }));
    await assertFails(nonMemberDb.collection('chatrooms').doc(roomId).collection('messages').add({ senderId: 'u2', text: 'no', imageUrl: '', timestamp: new Date(), deliveredTo: ['u2'], seenBy: [] }));
  });

  it('admin can add/remove; member cannot remove others; member can self-delete', async () => {
    const roomId = 'r2';
    const admin = authedCtx('a1');
    const member = authedCtx('m1');

    const adminDb = testEnv.authenticatedContext(admin.uid).firestore();
    await adminDb.collection('chatrooms').doc(roomId).set({ title: 'Room2', createdBy: admin.uid });
    await adminDb.collection('chatrooms').doc(roomId).collection('members').doc('a1').set({ role: 'admin' });

    // Admin adds a member
    await assertSucceeds(adminDb.collection('chatrooms').doc(roomId).collection('members').doc('m1').set({ role: 'member' }));

    // Member tries to remove another -> fail
    const memberDb = testEnv.authenticatedContext(member.uid).firestore();
    await assertFails(memberDb.collection('chatrooms').doc(roomId).collection('members').doc('a1').delete());

    // Member deletes self (leave room) -> success
    await assertSucceeds(memberDb.collection('chatrooms').doc(roomId).collection('members').doc('m1').delete());
  });
});
