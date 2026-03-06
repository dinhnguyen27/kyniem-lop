const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

exports.sendPushFromEvent = functions.firestore
  .document('notification_events/{eventId}')
  .onCreate(async (snap) => {
    const event = snap.data() || {};
    const type = event.type;

    if (!type) return null;

    if (type === 'chat_new_message') {
      const receiverEmail = String(event.receiverEmail || '').toLowerCase();
      if (!receiverEmail) return null;

      const userSnap = await db.collection('users')
        .where('email', '==', receiverEmail)
        .limit(1)
        .get();

      if (userSnap.empty) return null;

      const userData = userSnap.docs[0].data() || {};
      const tokens = Array.isArray(userData.fcmTokens) ? userData.fcmTokens.filter(Boolean) : [];
      if (!tokens.length) return null;

      const senderName = event.senderName || 'Bạn cùng lớp';
      const textPreview = event.textPreview || 'Bạn có tin nhắn mới';

      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: `💬 ${senderName} vừa nhắn tin`,
          body: textPreview
        },
        data: {
          type: 'chat_new_message',
          senderEmail: String(event.senderEmail || ''),
          receiverEmail
        }
      });

      return cleanupInvalidTokens(userSnap.docs[0].ref, tokens, response.responses);
    }

    if (type === 'capsule_unlocked') {
      const users = await db.collection('users').get();
      const sendJobs = [];

      users.forEach((doc) => {
        const userData = doc.data() || {};
        const tokens = Array.isArray(userData.fcmTokens) ? userData.fcmTokens.filter(Boolean) : [];
        if (!tokens.length) return;

        sendJobs.push(sendCapsulePush(doc.ref, tokens, event));
      });

      await Promise.all(sendJobs);
    }

    return null;
  });

async function sendCapsulePush(userRef, tokens, event) {
  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title: '✉️ Hộp thư thời gian mở khóa',
      body: event.body || 'Có thư mới vừa được mở khóa.'
    },
    data: {
      type: 'capsule_unlocked'
    }
  });

  return cleanupInvalidTokens(userRef, tokens, response.responses);
}

async function cleanupInvalidTokens(userRef, tokens, responses) {
  const invalidTokens = [];

  responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (!invalidTokens.length) return null;

  return userRef.update({
    fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens)
  });
}
