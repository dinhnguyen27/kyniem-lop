const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const DEFAULT_WEBPUSH_LINK = 'https://dinhnguyen27.github.io/kyniem-lop/';
const PUSH_REGION = 'asia-southeast1';

function normalizePushLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_WEBPUSH_LINK;
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith('/') ? raw.slice(1) : raw;
  return `${DEFAULT_WEBPUSH_LINK}${path}`;
}

function chunkArray(items, chunkSize = 500) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(chunkSize) || 500);
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

function extractUserTokens(userData = {}) {
  const listTokens = Array.isArray(userData.fcmTokens)
    ? userData.fcmTokens.filter(Boolean)
    : [];
  const legacyToken = String(userData.fcmToken || '').trim();

  if (legacyToken) {
    listTokens.push(legacyToken);
  }

  return [...new Set(listTokens.map((token) => String(token || '').trim()).filter(Boolean))];
}

async function collectGroupRecipientTokens(senderEmail = '') {
  const users = await db.collection('users').get();
  const tokens = [];

  users.forEach((doc) => {
    const userData = doc.data() || {};
    const email = String(userData.email || '').toLowerCase();
    if (!email || email === String(senderEmail || '').toLowerCase()) return;

    const userTokens = extractUserTokens(userData);
    if (!userTokens.length) return;
    tokens.push(...userTokens);
  });

  return {
    usersCount: users.size,
    uniqueTokens: [...new Set(tokens)]
  };
}

exports.sendPushFromEvent = functions.region(PUSH_REGION).firestore
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
            const tokens = extractUserTokens(userData);
      if (!tokens.length) {
        functions.logger.warn('Người nhận chưa có FCM token', { receiverEmail });
        return null;
      }

      const senderName = event.senderName || 'Bạn cùng lớp';
      const textPreview = event.textPreview || 'Bạn có tin nhắn mới';
      const sentAt = String(event.sentAt || Date.now());

      const pushLink = normalizePushLink(event.link);

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
        const tokens = extractUserTokens(userData);
        if (!tokens.length) return;

        sendJobs.push(sendCapsulePush(doc.ref, tokens, event));
      });

      await Promise.all(sendJobs);
      functions.logger.info('Đã xử lý gửi capsule push', { users: usersCount, jobs: sendJobs.length });
    }

    if (type === 'group_chat_new_message') {
      const senderEmail = String(event.senderEmail || '').toLowerCase();
      const senderName = String(event.senderName || 'Bạn cùng lớp');
      const sentAt = String(event.sentAt || Date.now());
      const body = String(event.body || `${senderName} đã nhắn tin vào nhóm chat`);
      const textPreview = String(event.textPreview || 'Mở ứng dụng để xem chi tiết tin nhắn mới.');
      const pushLink = normalizePushLink(event.link);

      const { usersCount, uniqueTokens } = await collectGroupRecipientTokens(senderEmail);
      const tokenBatches = chunkArray(uniqueTokens, 500);

      await Promise.all(tokenBatches.map((batchTokens) => sendGroupChatPush(batchTokens, {
        senderEmail,
        senderName,
        sentAt,
        body,
        textPreview,
        link: pushLink
      })));

      functions.logger.info('Đã xử lý gửi group chat push', {
        users: usersCount,
        tokenCount: uniqueTokens.length,
        batches: tokenBatches.length,
        senderEmail
      });
    }

    return null;
  });

async function sendCapsulePush(userRef, tokens, event) {
  const pushLink = normalizePushLink(event.link);

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

async function sendGroupChatPush(tokens, event) {
  const pushLink = normalizePushLink(event.link);
  const senderName = String(event.senderName || 'Bạn cùng lớp');
  const body = String(event.body || `${senderName} đã nhắn tin vào nhóm chat`);
  const textPreview = String(event.textPreview || 'Mở ứng dụng để xem chi tiết tin nhắn mới.');
  const senderEmail = String(event.senderEmail || '');
  const sentAt = String(event.sentAt || Date.now());
  const notificationTag = `group_chat_new_message_${sentAt}`;

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    android: {
      priority: 'high'
    },
    data: {
      type: 'group_chat_new_message',
      senderEmail,
      senderName,
      title: body,
      body: textPreview,
      sentAt,
      link: pushLink,
      icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
      tag: notificationTag
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
        title: body,
        body: textPreview,
        icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
        requireInteraction: true,
        tag: notificationTag
      }
    }
  });

  return response;
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


exports.sendGroupPushOnMessageCreate = functions.region(PUSH_REGION).firestore
  .document('group_messages/{messageId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    const senderEmail = String(data.senderEmail || '').toLowerCase();
    const senderName = String(data.senderName || senderEmail || 'Bạn cùng lớp');
    const text = String(data.text || '').trim();
    const sentAt = String(data.createdAt || Date.now());

    const body = `${senderName} đã nhắn tin vào nhóm chat`;
    const textPreview = text ? (text.length > 140 ? `${text.slice(0, 140)}…` : text) : 'Mở ứng dụng để xem chi tiết tin nhắn mới.';
    const pushLink = normalizePushLink('/');

    const { usersCount, uniqueTokens } = await collectGroupRecipientTokens(senderEmail);
    const tokenBatches = chunkArray(uniqueTokens, 500);

    await Promise.all(tokenBatches.map((batchTokens) => sendGroupChatPush(batchTokens, {
      senderEmail,
      senderName,
      sentAt,
      body,
      textPreview,
      link: pushLink
    })));

    functions.logger.info('Đã gửi push từ trigger group_messages', {
      messageId: context.params.messageId,
      users: usersCount,
      tokenCount: uniqueTokens.length,
      batches: tokenBatches.length,
      senderEmail
    });

    return null;
  });

