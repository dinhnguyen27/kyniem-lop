#!/usr/bin/env node

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getChatKey(emailA, emailB) {
  return [normalizeEmail(emailA), normalizeEmail(emailB)].sort().join('__');
}

function isLegacyTopLevelMessage(data = {}) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.senderEmail &&
    data.receiverEmail &&
    typeof data.text === 'string' &&
    data.createdAt
  );
}

function getLatestMetadata(current, data = {}) {
  const createdAt = Number(data.createdAt || 0);
  if (!createdAt) return current;
  if (!current || createdAt > current.createdAt) {
    return {
      createdAt,
      senderEmail: normalizeEmail(data.senderEmail),
      senderName: data.senderName || normalizeEmail(data.senderEmail),
      text: data.text || '',
      participants: Array.isArray(data.participants)
        ? data.participants.map((value) => normalizeEmail(value)).filter(Boolean).sort()
        : []
    };
  }
  return current;
}

async function migratePrivateMessages({ dryRun = true } = {}) {
  const snapshot = await db.collection('private_messages').get();

  const legacyDocs = [];
  const conversationDocIds = [];
  const latestByChatKey = new Map();

  snapshot.forEach((doc) => {
    const data = doc.data();

    if (isLegacyTopLevelMessage(data)) {
      const senderEmail = normalizeEmail(data.senderEmail);
      const receiverEmail = normalizeEmail(data.receiverEmail);
      if (!senderEmail || !receiverEmail) return;

      const chatKey = getChatKey(senderEmail, receiverEmail);
      const createdAt = Number(data.createdAt || 0);

      const payload = {
        chatKey,
        participants: [senderEmail, receiverEmail].sort(),
        senderEmail,
        senderName: data.senderName || senderEmail,
        senderAvatar: data.senderAvatar || null,
        receiverEmail,
        text: data.text || '',
        createdAt,
        migratedFromLegacyDocId: doc.id,
        migratedAt: Date.now()
      };

      legacyDocs.push({ id: doc.id, chatKey, payload });
      latestByChatKey.set(chatKey, getLatestMetadata(latestByChatKey.get(chatKey), payload));
      return;
    }

    if (Array.isArray(data?.participants)) {
      conversationDocIds.push(doc.id);
      latestByChatKey.set(doc.id, getLatestMetadata(latestByChatKey.get(doc.id), {
        createdAt: data.lastMessageAt,
        senderEmail: data.lastSenderEmail,
        senderName: data.lastSenderName,
        text: data.lastMessageText,
        participants: data.participants
      }));
    }
  });

  console.log(`[scan] total private_messages docs: ${snapshot.size}`);
  console.log(`[scan] legacy top-level message docs to migrate: ${legacyDocs.length}`);
  console.log(`[scan] conversation docs detected: ${conversationDocIds.length}`);

  if (dryRun) {
    console.log('[dry-run] No data was written. Run with --execute to apply migration.');
    return;
  }

  let batch = db.batch();
  let writes = 0;
  let migratedLegacyMessages = 0;
  let migratedOldSubcollectionMessages = 0;

  const commitIfNeeded = async () => {
    if (writes >= 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  };

  for (const item of legacyDocs) {
    const conversationRef = db.collection('private_messages').doc(item.chatKey);
    const messageRef = conversationRef.collection('tin_nhan').doc(item.id);

    batch.set(messageRef, item.payload, { merge: true });
    writes += 1;
    migratedLegacyMessages += 1;
    await commitIfNeeded();
  }

  // move old subcollection messages/* -> tin_nhan/* so Firestore path is always:
  // private_messages/{nguoi_nhan_nguoi_gui}/tin_nhan/{messageId}
  for (const chatKey of conversationDocIds) {
    const conversationRef = db.collection('private_messages').doc(chatKey);
    const oldMessagesSnap = await conversationRef.collection('messages').get();

    oldMessagesSnap.forEach((doc) => {
      const payload = doc.data() || {};
      batch.set(conversationRef.collection('tin_nhan').doc(doc.id), payload, { merge: true });
      writes += 1;
      migratedOldSubcollectionMessages += 1;
      latestByChatKey.set(chatKey, getLatestMetadata(latestByChatKey.get(chatKey), payload));
    });

    await commitIfNeeded();
  }

  if (writes > 0) {
    await batch.commit();
  }

  let updatedConversations = 0;
  for (const [chatKey, latest] of latestByChatKey.entries()) {
    if (!latest?.createdAt) continue;

    const conversationRef = db.collection('private_messages').doc(chatKey);
    const conversationSnap = await conversationRef.get();
    const currentLastMessageAt = Number(conversationSnap.get('lastMessageAt') || 0);

    if (currentLastMessageAt > latest.createdAt) {
      continue;
    }

    await conversationRef.set({
      chatKey,
      participants: latest.participants,
      lastSenderEmail: latest.senderEmail,
      lastSenderName: latest.senderName,
      lastMessageText: latest.text,
      lastMessageAt: latest.createdAt,
      updatedAt: Date.now(),
      migratedLegacy: true,
      messagesPath: `private_messages/${chatKey}/tin_nhan`
    }, { merge: true });

    updatedConversations += 1;
  }

  console.log(`[done] migrated legacy top-level message docs: ${migratedLegacyMessages}`);
  console.log(`[done] migrated old subcollection messages -> tin_nhan: ${migratedOldSubcollectionMessages}`);
  console.log(`[done] updated conversation metadata docs: ${updatedConversations}`);
}

const shouldExecute = process.argv.includes('--execute');
migratePrivateMessages({ dryRun: !shouldExecute })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[error] migrate private messages failed:', error);
    process.exit(1);
  });
