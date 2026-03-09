const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const DEFAULT_WEBPUSH_LINK = 'https://dinhnguyen27.github.io/kyniem-lop/';

exports.sendPushFromEvent = functions.firestore
  .document('notification_events/{eventId}')
  .onCreate(async (snap, context) => {
    const event = snap.data() || {};
    const type = event.type;

    functions.logger.info('Nhận notification event', { eventId: context.params.eventId, type });

    if (!type) return null;

    if (type === 'chat_new_message') {
      const receiverEmail = String(event.receiverEmail || '').toLowerCase();
      if (!receiverEmail) return null;

      const userSnap = await db.collection('users')
        .where('email', '==', receiverEmail)
        .limit(1)
        .get();

      if (userSnap.empty) {
        functions.logger.warn('Không tìm thấy người nhận để gửi chat push', { receiverEmail });
        return null;
      }

      const userData = userSnap.docs[0].data() || {};
      const tokens = Array.isArray(userData.fcmTokens) ? userData.fcmTokens.filter(Boolean) : [];
      if (!tokens.length) {
        functions.logger.warn('Người nhận chưa có FCM token', { receiverEmail });
        return null;
      }

      const senderName = event.senderName || 'Bạn cùng lớp';
      const textPreview = event.textPreview || 'Bạn có tin nhắn mới';
      const sentAt = String(event.sentAt || Date.now());

      const pushLink = String(event.link || DEFAULT_WEBPUSH_LINK);

      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        android: {
          priority: 'high'
        },
        data: {
          type: 'chat_new_message',
          senderEmail: String(event.senderEmail || ''),
          receiverEmail,
          title: `💬 ${senderName} vừa nhắn tin`,
          body: textPreview,
          senderName: String(senderName),
          sentAt,
          link: pushLink,
          icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
          tag: 'chat_new_message'
        },
        webpush: {
          headers: {
            Urgency: 'high',
            TTL: '2419200'
          },
          fcmOptions: {
            link: pushLink
          },
          notification: {
            title: `💬 ${senderName} vừa nhắn tin`,
            body: textPreview,
            icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
            requireInteraction: true
          }
        }
      });

      functions.logger.info('Kết quả gửi chat push', {
        receiverEmail,
        successCount: response.successCount,
        failureCount: response.failureCount
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
      functions.logger.info('Đã xử lý gửi capsule push', { users: users.size, jobs: sendJobs.length });
    }

    if (type === 'group_chat_new_message') {
      const senderEmail = String(event.senderEmail || '').toLowerCase();
      const senderName = String(event.senderName || 'Bạn cùng lớp');
      const sentAt = String(event.sentAt || Date.now());
      const body = String(event.body || `${senderName} đã nhắn tin vào nhóm chat`);
      const pushLink = String(event.link || DEFAULT_WEBPUSH_LINK);

      const users = await db.collection('users').get();
      const sendJobs = [];

      users.forEach((doc) => {
        const userData = doc.data() || {};
        const email = String(userData.email || '').toLowerCase();
        if (!email || email === senderEmail) return;

        const tokens = Array.isArray(userData.fcmTokens) ? userData.fcmTokens.filter(Boolean) : [];
        if (!tokens.length) return;

        sendJobs.push(sendGroupChatPush(doc.ref, tokens, {
          senderEmail,
          senderName,
          sentAt,
          body,
          link: pushLink
        }));
      });

      await Promise.all(sendJobs);
      functions.logger.info('Đã xử lý gửi group chat push', { users: users.size, jobs: sendJobs.length, senderEmail });
    }

    return null;
  });

async function sendCapsulePush(userRef, tokens, event) {
  const pushLink = String(event.link || DEFAULT_WEBPUSH_LINK);

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    android: {
      priority: 'high'
    },
    data: {
      type: 'capsule_unlocked',
      title: '✉️ Hộp thư thời gian mở khóa',
      body: event.body || 'Có thư mới vừa được mở khóa.',
      link: pushLink,
      icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
      tag: 'capsule_unlocked'
    },
    webpush: {
      headers: {
        Urgency: 'high',
        TTL: '2419200'
      },
      fcmOptions: {
        link: pushLink
      },
      notification: {
        title: '✉️ Hộp thư thời gian mở khóa',
        body: event.body || 'Có thư mới vừa được mở khóa.',
        icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
        requireInteraction: true
      }
    }
  });

  return cleanupInvalidTokens(userRef, tokens, response.responses);
}

async function sendGroupChatPush(userRef, tokens, event) {
  const pushLink = String(event.link || DEFAULT_WEBPUSH_LINK);
  const senderName = String(event.senderName || 'Bạn cùng lớp');
  const body = String(event.body || `${senderName} đã nhắn tin vào nhóm chat`);
  const senderEmail = String(event.senderEmail || '');
  const sentAt = String(event.sentAt || Date.now());

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    android: {
      priority: 'high'
    },
    data: {
      type: 'group_chat_new_message',
      senderEmail,
      senderName,
      title: '👥 Tin nhắn nhóm chat chung',
      body,
      sentAt,
      link: pushLink,
      icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
      tag: 'group_chat_new_message'
    },
    webpush: {
      headers: {
        Urgency: 'high',
        TTL: '2419200'
      },
      fcmOptions: {
        link: pushLink
      },
      notification: {
        title: '👥 Tin nhắn nhóm chat chung',
        body,
        icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
        requireInteraction: true
      }
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

