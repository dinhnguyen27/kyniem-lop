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

async function migratePrivateMessages({ dryRun = true } = {}) {
  const snapshot = await db.collection('private_messages').get();

  const legacyDocs = [];
  const latestByChatKey = new Map();

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!isLegacyTopLevelMessage(data)) return;

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

    const currentLatest = latestByChatKey.get(chatKey);
    if (!currentLatest || createdAt > currentLatest.createdAt) {
      latestByChatKey.set(chatKey, {
        createdAt,
        senderEmail,
        senderName: payload.senderName,
        text: payload.text,
        participants: payload.participants
      });
    }
  });

  console.log(`[scan] total private_messages docs: ${snapshot.size}`);
  console.log(`[scan] legacy top-level message docs to migrate: ${legacyDocs.length}`);
  console.log(`[scan] affected conversations: ${latestByChatKey.size}`);

  if (legacyDocs.length === 0) {
    console.log('[done] No legacy message documents found.');
    return;
  }

  if (dryRun) {
    console.log('[dry-run] No data was written. Run with --execute to apply migration.');
    return;
  }

  let batch = db.batch();
  let writes = 0;
  let migratedMessages = 0;

  for (const item of legacyDocs) {
    const conversationRef = db.collection('private_messages').doc(item.chatKey);
    const messageRef = conversationRef.collection('messages').doc(item.id);

    batch.set(messageRef, item.payload, { merge: true });
    writes += 1;
    migratedMessages += 1;

    if (writes >= 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }

  if (writes > 0) {
    await batch.commit();
  }

  let updatedConversations = 0;
  for (const [chatKey, latest] of latestByChatKey.entries()) {
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
      migratedLegacy: true
    }, { merge: true });

    updatedConversations += 1;
  }

  console.log(`[done] migrated message docs: ${migratedMessages}`);
  console.log(`[done] updated conversation metadata docs: ${updatedConversations}`);
}

const shouldExecute = process.argv.includes('--execute');
migratePrivateMessages({ dryRun: !shouldExecute })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[error] migrate private messages failed:', error);
    process.exit(1);
  });
